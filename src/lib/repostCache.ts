import type { Event } from 'nostr-tools'
import { db, type CachedRepostRow } from './db'
import { filterOutDeletedPosts } from './deletions'
import {
  hydrateRepostsToFeedPosts,
  parseFeedPost,
  parseRepostPointers,
  type FeedPost,
} from './posts'
import { cachePostFromEvent } from './postCache'

export async function cacheRepostEvent(
  event: Event,
  original?: Event | null,
): Promise<CachedRepostRow | null> {
  const ptr = parseRepostPointers(event)
  if (!ptr) return null

  // Don't revive a repost we already unreposted
  const existing = await db.reposts.get(event.id)
  if (existing?.active === 0) return existing

  let originalEvent = original ?? ptr.embedded
  if (originalEvent) {
    await cachePostFromEvent(originalEvent)
  }

  const row: CachedRepostRow = {
    id: event.id,
    reposterPubkey: event.pubkey,
    originalEventId: ptr.originalEventId,
    originalPubkey: ptr.originalPubkey || originalEvent?.pubkey || '',
    createdAt: event.created_at,
    eventJson: JSON.stringify(event),
    originalEventJson: originalEvent ? JSON.stringify(originalEvent) : null,
    active: 1,
    updatedAt: Date.now(),
  }
  await db.reposts.put(row)
  return row
}

export async function cacheRepostEvents(events: Event[]): Promise<void> {
  for (const event of events) {
    await cacheRepostEvent(event)
  }
}

export async function loadCachedRepostFeedPosts(
  allowedReposters?: string[],
): Promise<FeedPost[]> {
  let rows = await db.reposts.orderBy('createdAt').reverse().toArray()
  rows = rows.filter((r) => r.active === undefined || r.active === 1)
  if (allowedReposters) {
    const allow = new Set(allowedReposters)
    rows = rows.filter((r) => allow.has(r.reposterPubkey))
  }

  const posts: FeedPost[] = []
  for (const row of rows) {
    try {
      const repostEvent = JSON.parse(row.eventJson) as Event
      let original: Event | null = row.originalEventJson
        ? (JSON.parse(row.originalEventJson) as Event)
        : null

      if (!original) {
        const cached = await db.posts.get(row.originalEventId)
        if (cached?.eventJson) {
          original = JSON.parse(cached.eventJson) as Event
        }
      }
      if (!original) continue
      const parsed = parseFeedPost(original)
      if (!parsed) continue
      posts.push({
        ...parsed,
        repost: {
          id: repostEvent.id,
          pubkey: repostEvent.pubkey,
          createdAt: repostEvent.created_at,
        },
      })
    } catch {
      // skip bad rows
    }
  }
  return filterOutDeletedPosts(posts)
}

export async function loadCachedRepostsByAuthor(
  pubkey: string,
): Promise<FeedPost[]> {
  return loadCachedRepostFeedPosts([pubkey])
}

/**
 * Persist hydrated reposts (with originals) for offline / instant profile+home.
 */
export async function cacheHydratedReposts(posts: FeedPost[]): Promise<void> {
  for (const post of posts) {
    if (!post.repost) continue
    const repostEvent: Event = {
      id: post.repost.id,
      pubkey: post.repost.pubkey,
      created_at: post.repost.createdAt,
      kind: 6,
      tags: [
        ['e', post.id],
        ['p', post.pubkey],
      ],
      content: JSON.stringify(post.raw),
      sig: '',
    }
    await cacheRepostEvent(repostEvent, post.raw)
  }
}

export async function resolveAndCacheReposts(
  repostEvents: Event[],
): Promise<FeedPost[]> {
  await cacheRepostEvents(repostEvents)
  const hydrated = await hydrateRepostsToFeedPosts(repostEvents)
  await cacheHydratedReposts(hydrated)
  return filterOutDeletedPosts(hydrated)
}
