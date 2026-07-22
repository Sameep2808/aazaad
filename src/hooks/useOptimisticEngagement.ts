import { useCallback, useEffect, useRef, useState } from 'react'
import type { Event } from 'nostr-tools'
import { useAuth } from '../context/AuthContext'
import {
  buildCommentEvent,
  buildLikeEvent,
  publishEvent,
  type FeedPost,
} from '../lib/posts'

export type EngageHandler = (
  postId: string,
  patch: { likes?: number; comments?: number },
) => void

/**
 * Optimistic likes/comments — UI updates immediately; relay publish runs in background.
 */
export function useOptimisticEngagement(
  post: FeedPost,
  onEngage?: EngageHandler,
) {
  const { pubkey, signEvent } = useAuth()
  const [likes, setLikes] = useState(post.likes)
  const [comments, setComments] = useState(post.comments)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const likesRef = useRef(likes)
  const commentsRef = useRef(comments)
  likesRef.current = likes
  commentsRef.current = comments

  // Never decrease local counts from a slow parent refresh (avoids flicker/delay feel)
  useEffect(() => {
    setLikes((prev) => Math.max(prev, post.likes))
    setComments((prev) => Math.max(prev, post.comments))
  }, [post.id, post.likes, post.comments])

  const like = useCallback(async () => {
    if (!pubkey) {
      setError('Log in to like')
      return
    }
    setError(null)
    const next = likesRef.current + 1
    setLikes(next)
    onEngage?.(post.id, { likes: next })

    try {
      const signed = await signEvent(buildLikeEvent(post.raw))
      // Fire-and-forget relay publish — don't block the UI
      void publishEvent(signed)
    } catch (err) {
      setLikes((n) => {
        const rolled = Math.max(0, n - 1)
        onEngage?.(post.id, { likes: rolled })
        return rolled
      })
      setError(err instanceof Error ? err.message : 'Like failed')
    }
  }, [pubkey, signEvent, post.id, post.raw, onEngage])

  const comment = useCallback(
    async (text: string) => {
      if (!pubkey) {
        setError('Log in to comment')
        return false
      }
      const trimmed = text.trim()
      if (!trimmed) return false

      setError(null)
      setBusy(true)
      const next = commentsRef.current + 1
      setComments(next)
      onEngage?.(post.id, { comments: next })

      try {
        const signed = await signEvent(buildCommentEvent(post.raw, trimmed))
        void publishEvent(signed)
        return true
      } catch (err) {
        setComments((n) => {
          const rolled = Math.max(0, n - 1)
          onEngage?.(post.id, { comments: rolled })
          return rolled
        })
        setError(err instanceof Error ? err.message : 'Comment failed')
        return false
      } finally {
        setBusy(false)
      }
    },
    [pubkey, signEvent, post.id, post.raw, onEngage],
  )

  return { likes, comments, busy, error, like, comment, setError }
}

export type { Event }
