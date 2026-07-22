import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  buildDeletionEvent,
  buildRepostEvent,
  publishEvent,
  type FeedPost,
} from '../lib/posts'
import { cacheRepostEvent } from '../lib/repostCache'
import { db } from '../lib/db'
import {
  getMyActiveRepost,
  isPostRepostedByMe,
} from '../lib/reactions'

/**
 * Toggle repost — one active Kind 6 per user per post; second press unreposts (NIP-09).
 */
export function useRepost() {
  const { pubkey, signEvent } = useAuth()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeIds, setActiveIds] = useState<Set<string>>(() => new Set())

  const mark = useCallback((postId: string, on: boolean) => {
    setActiveIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(postId)
      else next.delete(postId)
      return next
    })
  }, [])

  const hydrate = useCallback(
    async (postIds: string[]) => {
      if (!pubkey) return
      const found: string[] = []
      await Promise.all(
        postIds.map(async (id) => {
          if (await isPostRepostedByMe(pubkey, id)) found.push(id)
        }),
      )
      if (found.length === 0) return
      setActiveIds((prev) => {
        const next = new Set(prev)
        for (const id of found) next.add(id)
        return next
      })
    },
    [pubkey],
  )

  useEffect(() => {
    if (!pubkey) setActiveIds(new Set())
  }, [pubkey])

  const toggleRepost = useCallback(
    async (post: FeedPost): Promise<'reposted' | 'unreposted' | false> => {
      if (!pubkey) {
        setError('Log in to repost')
        return false
      }
      const target = post.raw
      const targetId = target.id
      if (busyId === targetId) return false

      setBusyId(targetId)
      setError(null)

      const currently =
        activeIds.has(targetId) || (await isPostRepostedByMe(pubkey, targetId))

      try {
        if (currently) {
          const existing = await getMyActiveRepost(pubkey, targetId)
          mark(targetId, false)
          if (existing) {
            await db.reposts.update(existing.id, {
              active: 0,
              updatedAt: Date.now(),
            })
            const signed = await signEvent(
              buildDeletionEvent([existing.id], 'unrepost'),
            )
            void publishEvent(signed)
          }
          return 'unreposted'
        }

        // Prevent double-repost if somehow still active
        const already = await getMyActiveRepost(pubkey, targetId)
        if (already) {
          mark(targetId, true)
          return 'reposted'
        }

        mark(targetId, true)
        const signed = await signEvent(buildRepostEvent(target))
        await cacheRepostEvent(signed, target)
        void publishEvent(signed)
        return 'reposted'
      } catch (err) {
        mark(targetId, currently)
        setError(err instanceof Error ? err.message : 'Repost failed')
        return false
      } finally {
        setBusyId(null)
      }
    },
    [pubkey, signEvent, busyId, activeIds, mark],
  )

  return {
    toggleRepost,
    repost: async (post: FeedPost) => {
      const result = await toggleRepost(post)
      return result === 'reposted' || result === 'unreposted'
    },
    busyId,
    error,
    isReposted: (postId: string) => activeIds.has(postId),
    hydrate,
    clearError: () => setError(null),
  }
}
