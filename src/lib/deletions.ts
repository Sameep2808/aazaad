import type { Event, EventTemplate } from 'nostr-tools'
import { db } from './db'
import {
  buildDeletionEvent,
  fetchAuthorsMediaEventsPage,
  publishEvent,
} from './posts'

const DELETE_BATCH = 40
const FETCH_PAGES_CAP = 30

export async function isEventDeleted(eventId: string): Promise<boolean> {
  return Boolean(await db.deletedEvents.get(eventId))
}

export async function markEventsDeleted(
  eventIds: string[],
  pubkey: string,
): Promise<void> {
  const now = Date.now()
  const unique = [...new Set(eventIds.filter(Boolean))]
  await db.transaction(
    'rw',
    db.deletedEvents,
    db.posts,
    db.reposts,
    async () => {
      for (const id of unique) {
        await db.deletedEvents.put({
          id,
          pubkey,
          deletedAt: now,
        })
        await db.posts.delete(id)
        await db.reposts.delete(id)
      }
    },
  )
}

export async function filterOutDeletedPosts<T extends { id: string }>(
  posts: T[],
): Promise<T[]> {
  if (posts.length === 0) return posts
  const ids = posts.map((p) => p.id)
  const deleted = await db.deletedEvents.where('id').anyOf(ids).primaryKeys()
  if (deleted.length === 0) return posts
  const banned = new Set(deleted)
  return posts.filter((p) => !banned.has(p.id))
}

/**
 * Publish NIP-09 Kind 5 for the given event ids (batched), then tombstone locally.
 */
export async function deleteOwnEvents(opts: {
  eventIds: string[]
  pubkey: string
  reason?: string
  signEvent: (template: EventTemplate) => Promise<Event>
}): Promise<{ deleted: number; published: number }> {
  const unique = [...new Set(opts.eventIds.filter(Boolean))]
  if (unique.length === 0) {
    return { deleted: 0, published: 0 }
  }

  let published = 0
  for (let i = 0; i < unique.length; i += DELETE_BATCH) {
    const chunk = unique.slice(i, i + DELETE_BATCH)
    const signed = await opts.signEvent(
      buildDeletionEvent(chunk, opts.reason ?? 'delete'),
    )
    try {
      await publishEvent(signed)
      published += chunk.length
    } catch {
      // Local tombstone still applies — relays may be offline
    }
  }

  await markEventsDeleted(unique, opts.pubkey)
  return { deleted: unique.length, published }
}

/** Delete a single post (or other owned event) from relays + local cache. */
export async function deleteOwnPost(opts: {
  postId: string
  pubkey: string
  signEvent: (template: EventTemplate) => Promise<Event>
}): Promise<void> {
  await deleteOwnEvents({
    eventIds: [opts.postId],
    pubkey: opts.pubkey,
    reason: 'delete post',
    signEvent: opts.signEvent,
  })
}

/** Collect media post event ids for an author (cache + paginated relays). */
export async function collectAuthorPostIds(pubkey: string): Promise<string[]> {
  const ids = new Set<string>()

  const cached = await db.posts.where('pubkey').equals(pubkey).toArray()
  for (const row of cached) ids.add(row.id)

  let until: number | undefined
  let authorChunkIndex = 0
  for (let page = 0; page < FETCH_PAGES_CAP; page++) {
    const result = await fetchAuthorsMediaEventsPage({
      authors: [pubkey],
      until,
      authorChunkIndex,
      limit: 50,
    })
    for (const event of result.events) {
      if (event.pubkey === pubkey) ids.add(event.id)
    }
    if (result.exhausted) break
    if (result.nextAuthorChunk != null && result.nextAuthorChunk > 0) {
      authorChunkIndex = result.nextAuthorChunk
    } else {
      authorChunkIndex = 0
      if (result.nextUntil == null) break
      until = result.nextUntil
    }
  }

  return [...ids]
}

/** Active Kind 6 repost event ids authored by this pubkey. */
export async function collectAuthorRepostIds(
  pubkey: string,
): Promise<string[]> {
  const rows = await db.reposts
    .where('reposterPubkey')
    .equals(pubkey)
    .filter((r) => r.active === undefined || r.active === 1)
    .toArray()
  return rows.map((r) => r.id)
}

/**
 * Wipe all local IndexedDB rows owned by this pubkey (account + caches + DMs).
 * Does not clear sessionStorage — caller should logout afterwards.
 */
export async function wipeLocalUserData(pubkey: string): Promise<void> {
  const pk = pubkey.toLowerCase()

  await db.transaction(
    'rw',
    [
      db.accounts,
      db.posts,
      db.profiles,
      db.follows,
      db.profileStats,
      db.reposts,
      db.myLikes,
      db.dmMessages,
      db.dmThreads,
      db.dmBlocks,
      db.dmAccepted,
      db.comments,
    ],
    async () => {
      await db.accounts.where('pubkey').equals(pubkey).delete()
      // pubkey may be stored mixed-case from extension; also match lowercase
      const accounts = await db.accounts.toArray()
      for (const acc of accounts) {
        if (acc.pubkey.toLowerCase() === pk) {
          await db.accounts.delete(acc.username)
        }
      }

      await db.posts.where('pubkey').equals(pubkey).delete()
      const posts = await db.posts.toArray()
      for (const row of posts) {
        if (row.pubkey.toLowerCase() === pk) await db.posts.delete(row.id)
      }

      await db.profiles.delete(pubkey)
      await db.follows.delete(pubkey)
      await db.profileStats.delete(pubkey)

      const reposts = await db.reposts
        .where('reposterPubkey')
        .equals(pubkey)
        .toArray()
      for (const row of reposts) await db.reposts.delete(row.id)

      await db.myLikes.where('pubkey').equals(pubkey).delete()

      await db.dmMessages.where('ownerPubkey').equals(pubkey).delete()
      await db.dmThreads.where('ownerPubkey').equals(pubkey).delete()
      await db.dmBlocks.where('ownerPubkey').equals(pubkey).delete()
      await db.dmAccepted.where('ownerPubkey').equals(pubkey).delete()

      const myComments = await db.comments.where('pubkey').equals(pubkey).toArray()
      for (const row of myComments) await db.comments.delete(row.id)
      // Keep deletedEvents tombstones so relays cannot revive wiped posts in this browser
    },
  )
}

/**
 * Delete all of the user's posts (NIP-09), wipe local account data.
 * Caller must logout / clear session after this resolves.
 */
export async function deleteAccountAndContent(opts: {
  pubkey: string
  signEvent: (template: EventTemplate) => Promise<Event>
}): Promise<{ postsDeleted: number }> {
  const [postIds, repostIds] = await Promise.all([
    collectAuthorPostIds(opts.pubkey),
    collectAuthorRepostIds(opts.pubkey),
  ])
  const eventIds = [...new Set([...postIds, ...repostIds])]

  await deleteOwnEvents({
    eventIds,
    pubkey: opts.pubkey,
    reason: 'delete account',
    signEvent: opts.signEvent,
  })

  await wipeLocalUserData(opts.pubkey)
  return { postsDeleted: postIds.length }
}
