import { useCallback, useEffect, useState } from 'react'
import type { Event } from 'nostr-tools'
import { useAuth } from '../context/AuthContext'
import {
  cacheComment,
  cacheComments,
  loadCachedComments,
  updateCachedCommentLikes,
} from '../lib/commentCache'
import {
  buildDeletionEvent,
  buildLikeEvent,
  listCommentsForPost,
  parseCommentEvent,
  publishEvent,
  sortCommentsByLikes,
  type PostComment,
} from '../lib/posts'
import {
  deactivateMyLike,
  getMyLike,
  saveMyLike,
} from '../lib/reactions'

/**
 * Cache-first comments for a post: paint IndexedDB instantly, then refresh relays.
 * Supports liking comments; list stays sorted by most likes.
 */
export function usePostComments(postId: string | null, open: boolean) {
  const { pubkey, signEvent } = useAuth()
  const [comments, setComments] = useState<PostComment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [likeBusyId, setLikeBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!postId) {
      setComments([])
      return
    }
    setError(null)
    try {
      const list = await listCommentsForPost(postId, { viewerPubkey: pubkey })
      setComments(list)
      void cacheComments(postId, list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load comments')
    } finally {
      setLoading(false)
    }
  }, [postId, pubkey])

  useEffect(() => {
    if (!open || !postId) {
      if (!open) {
        setComments([])
        setLoading(false)
        setError(null)
      }
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      const cached = await loadCachedComments(postId, pubkey)
      if (cancelled) return
      if (cached.length > 0) {
        setComments(cached)
        setLoading(false)
      }
      await refresh()
    })()

    return () => {
      cancelled = true
    }
  }, [open, postId, pubkey, refresh])

  const prepend = useCallback(
    (event: Event) => {
      if (!postId) return
      const parsed = parseCommentEvent(event, postId, {
        likes: 0,
        likedByMe: false,
      })
      if (!parsed) return
      setComments((prev) => {
        if (prev.some((c) => c.id === parsed.id)) return prev
        const next = sortCommentsByLikes([parsed, ...prev])
        void cacheComment(parsed, postId)
        return next
      })
    },
    [postId],
  )

  const toggleLike = useCallback(
    async (comment: PostComment) => {
      if (!pubkey) {
        setError('Log in to like comments')
        return
      }
      if (likeBusyId) return
      setLikeBusyId(comment.id)
      setError(null)

      const wasLiked = comment.likedByMe
      const nextLikes = Math.max(0, comment.likes + (wasLiked ? -1 : 1))

      setComments((prev) =>
        sortCommentsByLikes(
          prev.map((c) =>
            c.id === comment.id
              ? { ...c, likes: nextLikes, likedByMe: !wasLiked }
              : c,
          ),
        ),
      )
      void updateCachedCommentLikes(comment.id, nextLikes)

      try {
        if (wasLiked) {
          const likeEventId = await deactivateMyLike(pubkey, comment.id)
          if (likeEventId) {
            const signed = await signEvent(
              buildDeletionEvent([likeEventId], 'unlike'),
            )
            void publishEvent(signed)
          } else {
            const row = await getMyLike(pubkey, comment.id)
            if (row?.likeEventId) {
              const signed = await signEvent(
                buildDeletionEvent([row.likeEventId], 'unlike'),
              )
              void publishEvent(signed)
            }
          }
        } else {
          const signed = await signEvent(buildLikeEvent(comment.raw))
          await saveMyLike({
            pubkey,
            postId: comment.id,
            likeEventId: signed.id,
          })
          void publishEvent(signed)
        }
      } catch (err) {
        setComments((prev) =>
          sortCommentsByLikes(
            prev.map((c) =>
              c.id === comment.id
                ? {
                    ...c,
                    likes: comment.likes,
                    likedByMe: wasLiked,
                  }
                : c,
            ),
          ),
        )
        void updateCachedCommentLikes(comment.id, comment.likes)
        setError(err instanceof Error ? err.message : 'Like failed')
      } finally {
        setLikeBusyId(null)
      }
    },
    [pubkey, signEvent, likeBusyId],
  )

  return {
    comments,
    loading,
    error,
    refresh,
    prepend,
    toggleLike,
    likeBusyId,
  }
}
