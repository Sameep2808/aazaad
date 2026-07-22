import type { Event } from 'nostr-tools'
import { db, type MyLikeRow } from './db'
import { DEFAULT_RELAYS, getPool } from './nostr'

export function myLikeKey(pubkey: string, postId: string): string {
  return `${pubkey}:${postId}`
}

export async function getMyLike(
  pubkey: string,
  postId: string,
): Promise<MyLikeRow | undefined> {
  return db.myLikes.get(myLikeKey(pubkey, postId))
}

export async function isPostLikedByMe(
  pubkey: string,
  postId: string,
): Promise<boolean> {
  const row = await getMyLike(pubkey, postId)
  return Boolean(row && row.active === 1)
}

export async function saveMyLike(opts: {
  pubkey: string
  postId: string
  likeEventId: string
  active?: boolean
}): Promise<void> {
  const row: MyLikeRow = {
    key: myLikeKey(opts.pubkey, opts.postId),
    pubkey: opts.pubkey,
    postId: opts.postId,
    likeEventId: opts.likeEventId,
    active: opts.active === false ? 0 : 1,
    updatedAt: Date.now(),
  }
  await db.myLikes.put(row)
}

export async function deactivateMyLike(
  pubkey: string,
  postId: string,
): Promise<string | null> {
  const row = await getMyLike(pubkey, postId)
  if (!row || row.active !== 1) return null
  await db.myLikes.update(row.key, { active: 0, updatedAt: Date.now() })
  return row.likeEventId
}

/** Active repost event id for this user + original post, if any. */
export async function getMyActiveRepost(
  pubkey: string,
  originalEventId: string,
): Promise<{ id: string } | null> {
  const rows = await db.reposts
    .where('originalEventId')
    .equals(originalEventId)
    .filter(
      (r) =>
        r.reposterPubkey === pubkey && (r.active === undefined || r.active === 1),
    )
    .toArray()
  if (rows.length === 0) return null
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return { id: rows[0].id }
}

export async function deactivateMyRepost(
  pubkey: string,
  originalEventId: string,
): Promise<string | null> {
  const current = await getMyActiveRepost(pubkey, originalEventId)
  if (!current) return null
  await db.reposts.update(current.id, { active: 0, updatedAt: Date.now() })
  return current.id
}

export async function isPostRepostedByMe(
  pubkey: string,
  originalEventId: string,
): Promise<boolean> {
  return Boolean(await getMyActiveRepost(pubkey, originalEventId))
}

/**
 * Sync local like/repost state from relays for the given post ids.
 */
export async function syncMyReactionsFromRelays(
  pubkey: string,
  postIds: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 4000,
): Promise<{ liked: Set<string>; reposted: Set<string> }> {
  const unique = [...new Set(postIds.filter(Boolean))]
  const liked = new Set<string>()
  const reposted = new Set<string>()
  if (!pubkey || unique.length === 0) return { liked, reposted }

  // Seed from local cache first
  await Promise.all(
    unique.map(async (postId) => {
      if (await isPostLikedByMe(pubkey, postId)) liked.add(postId)
      if (await isPostRepostedByMe(pubkey, postId)) reposted.add(postId)
    }),
  )

  const pool = getPool()
  const relayList = [...relays]
  const chunkSize = 40

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    try {
      const [likeEvents, repostEvents] = await Promise.all([
        pool.querySync(
          relayList,
          { kinds: [7], authors: [pubkey], '#e': chunk, limit: 200 },
          { maxWait },
        ),
        pool.querySync(
          relayList,
          { kinds: [6], authors: [pubkey], '#e': chunk, limit: 200 },
          { maxWait },
        ),
      ])

        for (const event of likeEvents) {
        if (event.content && event.content !== '+' && event.content !== '') {
          if (!['+', '❤️', '🤙', '💜'].includes(event.content)) continue
        }
        const eTag = event.tags.find((t) => t[0] === 'e')?.[1]
        if (!eTag) continue
        const existing = await getMyLike(pubkey, eTag)
        // Respect a local unlike of this same like event
        if (existing?.active === 0 && existing.likeEventId === event.id) {
          continue
        }
        // Local unlike newer than this like event
        if (
          existing?.active === 0 &&
          existing.updatedAt > event.created_at * 1000
        ) {
          continue
        }
        await saveMyLike({
          pubkey,
          postId: eTag,
          likeEventId: event.id,
          active: true,
        })
        liked.add(eTag)
      }

      for (const event of repostEvents) {
        const eTag = event.tags.find((t) => t[0] === 'e')?.[1]
        if (!eTag) continue
        const row = await db.reposts.get(event.id)
        if (row?.active === 0) continue
        await db.reposts.put({
          id: event.id,
          reposterPubkey: pubkey,
          originalEventId: eTag,
          originalPubkey:
            event.tags.find((t) => t[0] === 'p')?.[1] ?? '',
          createdAt: event.created_at,
          eventJson: JSON.stringify(event),
          originalEventJson: row?.originalEventJson ?? null,
          active: 1,
          updatedAt: Date.now(),
        })
        reposted.add(eTag)
      }
    } catch {
      // keep cache
    }
  }

  return { liked, reposted }
}

export type { Event }
