import type { Event } from 'nostr-tools'
import { db, type CachedPostRow } from './db'
import { parseFeedPost, type FeedPost } from './posts'

export async function cachePostFromEvent(
  event: Event,
  engagement?: { likes?: number; comments?: number },
): Promise<FeedPost | null> {
  const parsed = parseFeedPost(event)
  if (!parsed) return null

  const existing = await db.posts.get(parsed.id)
  const likes = Math.max(
    engagement?.likes ?? 0,
    parsed.likes,
    existing?.likes ?? 0,
  )
  const comments = Math.max(
    engagement?.comments ?? 0,
    parsed.comments,
    existing?.comments ?? 0,
  )

  const row: CachedPostRow = {
    id: parsed.id,
    pubkey: parsed.pubkey,
    createdAt: parsed.createdAt,
    cid: parsed.cid,
    mediaType: parsed.mediaType,
    mimeType: parsed.mimeType,
    caption: parsed.caption,
    eventJson: JSON.stringify(event),
    likes,
    comments,
    updatedAt: Date.now(),
  }
  await db.posts.put(row)
  return { ...parsed, likes, comments }
}

export async function cachePostsFromEvents(events: Event[]): Promise<FeedPost[]> {
  const posts: FeedPost[] = []
  for (const event of events) {
    const post = await cachePostFromEvent(event)
    if (post) posts.push(post)
  }
  return posts
}

export async function updateCachedEngagement(
  postId: string,
  patch: { likes?: number; comments?: number },
): Promise<void> {
  const row = await db.posts.get(postId)
  if (!row) return
  await db.posts.update(postId, {
    likes: patch.likes !== undefined ? Math.max(row.likes ?? 0, patch.likes) : row.likes ?? 0,
    comments:
      patch.comments !== undefined
        ? Math.max(row.comments ?? 0, patch.comments)
        : row.comments ?? 0,
    updatedAt: Date.now(),
  })
}

export function rowToFeedPost(row: CachedPostRow): FeedPost | null {
  try {
    const event = JSON.parse(row.eventJson) as Event
    const parsed = parseFeedPost(event)
    if (!parsed) return null
    return {
      ...parsed,
      likes: Math.max(parsed.likes, row.likes ?? 0),
      comments: Math.max(parsed.comments, row.comments ?? 0),
    }
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

/** Merge posts by id, preferring newer createdAt / higher engagement. */
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
      } else if (prev) {
        byId.set(post.id, {
          ...prev,
          likes: Math.max(post.likes, prev.likes),
          comments: Math.max(post.comments, prev.comments),
        })
      }
    }
  }
  return [...byId.values()]
}

/**
 * Home feed: only the viewer's posts + people they follow.
 * If not logged in, returns an empty list.
 */
export function filterFollowingFeed(
  posts: FeedPost[],
  viewerPubkey: string | null | undefined,
  following: string[],
): FeedPost[] {
  if (!viewerPubkey) return []
  const allowed = new Set<string>([viewerPubkey, ...following])
  return posts.filter((post) => allowed.has(post.pubkey))
}
