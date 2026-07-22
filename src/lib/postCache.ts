import type { Event } from 'nostr-tools'
import { db, type CachedPostRow } from './db'
import { parseFeedPost, type FeedPost } from './posts'

export async function cachePostFromEvent(event: Event): Promise<FeedPost | null> {
  const parsed = parseFeedPost(event)
  if (!parsed) return null

  const row: CachedPostRow = {
    id: parsed.id,
    pubkey: parsed.pubkey,
    createdAt: parsed.createdAt,
    cid: parsed.cid,
    mediaType: parsed.mediaType,
    mimeType: parsed.mimeType,
    caption: parsed.caption,
    eventJson: JSON.stringify(event),
    updatedAt: Date.now(),
  }
  await db.posts.put(row)
  return parsed
}

export async function cachePostsFromEvents(events: Event[]): Promise<FeedPost[]> {
  const posts: FeedPost[] = []
  for (const event of events) {
    const post = await cachePostFromEvent(event)
    if (post) posts.push(post)
  }
  return posts
}

export function rowToFeedPost(row: CachedPostRow): FeedPost | null {
  try {
    const event = JSON.parse(row.eventJson) as Event
    return parseFeedPost(event)
  } catch {
    return null
  }
}

export async function loadCachedPosts(): Promise<FeedPost[]> {
  const rows = await db.posts.orderBy('createdAt').reverse().toArray()
  return rows.map(rowToFeedPost).filter((p): p is FeedPost => p !== null)
}

export async function loadCachedPostsByAuthor(pubkey: string): Promise<FeedPost[]> {
  const rows = await db.posts.where('pubkey').equals(pubkey).toArray()
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rows.map(rowToFeedPost).filter((p): p is FeedPost => p !== null)
}

/** Merge posts by id, preferring newer createdAt / higher engagement later. */
export function mergePosts(...lists: FeedPost[][]): FeedPost[] {
  const byId = new Map<string, FeedPost>()
  for (const list of lists) {
    for (const post of list) {
      const prev = byId.get(post.id)
      if (!prev || post.createdAt >= prev.createdAt) {
        byId.set(post.id, {
          ...post,
          likes: Math.max(post.likes, prev?.likes ?? 0),
          comments: Math.max(post.comments, prev?.comments ?? 0),
        })
      }
    }
  }
  return [...byId.values()]
}
