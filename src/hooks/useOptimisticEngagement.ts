import { useCallback, useEffect, useRef, useState } from 'react'
import type { Event } from 'nostr-tools'
import { useAuth } from '../context/AuthContext'
import {
  buildCommentEvent,
  buildDeletionEvent,
  buildLikeEvent,
  publishEvent,
  type FeedPost,
} from '../lib/posts'
import {
  deactivateMyLike,
  getMyLike,
  isPostLikedByMe,
  saveMyLike,
} from '../lib/reactions'

export type EngageHandler = (
  postId: string,
  patch: { likes?: number; comments?: number },
) => void

/**
 * Optimistic likes/comments with toggle unlike (NIP-09 delete).
 * One active like per user per post.
 */
export function useOptimisticEngagement(
  post: FeedPost,
  onEngage?: EngageHandler,
) {
  const { pubkey, signEvent } = useAuth()
  const [likes, setLikes] = useState(post.likes)
  const [comments, setComments] = useState(post.comments)
  const [liked, setLiked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [likeBusy, setLikeBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const likesRef = useRef(likes)
  const commentsRef = useRef(comments)
  const likedRef = useRef(liked)
  likesRef.current = likes
  commentsRef.current = comments
  likedRef.current = liked

  // Reset when switching posts
  useEffect(() => {
    setLikes(post.likes)
    setComments(post.comments)
    setLiked(false)
    let cancelled = false
    if (pubkey) {
      void isPostLikedByMe(pubkey, post.id).then((v) => {
        if (!cancelled) setLiked(v)
      })
    }
    return () => {
      cancelled = true
    }
  }, [post.id, pubkey])

  // Parent refresh: don't clobber a just-unliked lower count; allow higher relay counts
  useEffect(() => {
    setLikes((prev) => {
      if (likedRef.current) return Math.max(prev, post.likes)
      // If we unliked locally, prefer not jumping back up unless relay is lower… keep max of post.likes and careful
      return post.likes
    })
    setComments((prev) => Math.max(prev, post.comments))
  }, [post.likes, post.comments, post.id])

  const like = useCallback(async () => {
    if (!pubkey) {
      setError('Log in to like')
      return
    }
    if (likeBusy) return
    setError(null)
    setLikeBusy(true)

    const currentlyLiked = likedRef.current

    if (currentlyLiked) {
      // Unlike
      const next = Math.max(0, likesRef.current - 1)
      setLiked(false)
      setLikes(next)
      onEngage?.(post.id, { likes: next })

      try {
        const likeEventId = await deactivateMyLike(pubkey, post.id)
        if (likeEventId) {
          const signed = await signEvent(
            buildDeletionEvent([likeEventId], 'unlike'),
          )
          void publishEvent(signed)
        } else {
          // Fallback: look up cached row again
          const row = await getMyLike(pubkey, post.id)
          if (row?.likeEventId) {
            const signed = await signEvent(
              buildDeletionEvent([row.likeEventId], 'unlike'),
            )
            void publishEvent(signed)
          }
        }
      } catch (err) {
        setLiked(true)
        setLikes((n) => {
          const rolled = n + 1
          onEngage?.(post.id, { likes: rolled })
          return rolled
        })
        setError(err instanceof Error ? err.message : 'Unlike failed')
      } finally {
        setLikeBusy(false)
      }
      return
    }

    // Like
    const next = likesRef.current + 1
    setLiked(true)
    setLikes(next)
    onEngage?.(post.id, { likes: next })

    try {
      const signed = await signEvent(buildLikeEvent(post.raw))
      await saveMyLike({
        pubkey,
        postId: post.id,
        likeEventId: signed.id,
        active: true,
      })
      void publishEvent(signed)
    } catch (err) {
      setLiked(false)
      setLikes((n) => {
        const rolled = Math.max(0, n - 1)
        onEngage?.(post.id, { likes: rolled })
        return rolled
      })
      setError(err instanceof Error ? err.message : 'Like failed')
    } finally {
      setLikeBusy(false)
    }
  }, [pubkey, signEvent, post.id, post.raw, onEngage, likeBusy])

  /** Instagram-style: double-tap only likes, never unlikes */
  const likeOnly = useCallback(async () => {
    if (likedRef.current) return
    await like()
  }, [like])


  const comment = useCallback(
    async (text: string): Promise<Event | null> => {
      if (!pubkey) {
        setError('Log in to comment')
        return null
      }
      const trimmed = text.trim()
      if (!trimmed) return null

      setError(null)
      setBusy(true)
      const next = commentsRef.current + 1
      setComments(next)
      onEngage?.(post.id, { comments: next })

      try {
        const signed = await signEvent(buildCommentEvent(post.raw, trimmed))
        void publishEvent(signed)
        return signed
      } catch (err) {
        setComments((n) => {
          const rolled = Math.max(0, n - 1)
          onEngage?.(post.id, { comments: rolled })
          return rolled
        })
        setError(err instanceof Error ? err.message : 'Comment failed')
        return null
      } finally {
        setBusy(false)
      }
    },
    [pubkey, signEvent, post.id, post.raw, onEngage],
  )

  return {
    likes,
    comments,
    liked,
    likeBusy,
    busy,
    error,
    like,
    likeOnly,
    comment,
    setError,
  }
}

export type { Event }
