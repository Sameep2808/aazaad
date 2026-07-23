import type { Event } from 'nostr-tools'
import { db, type CachedCommentRow } from './db'
import {
  sortCommentsByLikes,
  type PostComment,
} from './posts'

export function rowToPostComment(
  row: CachedCommentRow,
  likedByMe = false,
): PostComment | null {
  try {
    const event = JSON.parse(row.eventJson) as Event
    return {
      id: row.id,
      pubkey: row.pubkey,
      content: row.content,
      createdAt: row.createdAt,
      likes: row.likes ?? 0,
      likedByMe,
      raw: event,
    }
  } catch {
    return null
  }
}

export async function loadCachedComments(
  postId: string,
  viewerPubkey?: string | null,
): Promise<PostComment[]> {
  const rows = await db.comments.where('postId').equals(postId).toArray()
  const comments: PostComment[] = []
  for (const row of rows) {
    let likedByMe = false
    if (viewerPubkey) {
      const like = await db.myLikes.get(`${viewerPubkey}:${row.id}`)
      likedByMe = Boolean(like && like.active === 1)
    }
    const parsed = rowToPostComment(row, likedByMe)
    if (parsed) comments.push(parsed)
  }
  return sortCommentsByLikes(comments)
}

export async function cacheComments(
  postId: string,
  comments: PostComment[],
): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.comments, async () => {
    for (const comment of comments) {
      const existing = await db.comments.get(comment.id)
      const row: CachedCommentRow = {
        id: comment.id,
        postId,
        pubkey: comment.pubkey,
        content: comment.content,
        createdAt: comment.createdAt,
        likes: Math.max(comment.likes, existing?.likes ?? 0),
        eventJson: JSON.stringify(comment.raw),
        updatedAt: now,
      }
      await db.comments.put(row)
    }
  })
}

export async function cacheComment(comment: PostComment, postId: string): Promise<void> {
  await cacheComments(postId, [comment])
}

export async function updateCachedCommentLikes(
  commentId: string,
  likes: number,
): Promise<void> {
  const row = await db.comments.get(commentId)
  if (!row) return
  await db.comments.update(commentId, {
    likes: Math.max(0, likes),
    updatedAt: Date.now(),
  })
}
