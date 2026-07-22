import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  countByTarget,
  fetchCommentsFor,
  fetchLikesFor,
  fetchRecentPostEvents,
  parseFeedPost,
  type FeedPost,
} from '../lib/posts'
import {
  cachePostsFromEvents,
  loadCachedPosts,
  mergePosts,
  updateCachedEngagement,
} from '../lib/postCache'
import { getMutualPubkeys, prioritizeMutualAuthors } from '../lib/mutuals'

export interface UseReelsResult {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  applyEngagement: (
    postId: string,
    patch: { likes?: number; comments?: number },
  ) => void
}

/** Newest-first ordering for the Reels swiper. */
export function sortReelsLatest(posts: FeedPost[]): FeedPost[] {
  return [...posts].sort(
    (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  )
}

/**
 * Latest media for Reels — mutual follows first, then everyone else.
 */
export function useReels(
  viewerPubkey?: string | null,
  following: string[] = [],
): UseReelsResult {
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const followingKey = useMemo(
    () => [...following].sort().join(','),
    [following],
  )
  const followingList = useMemo(
    () => (followingKey ? followingKey.split(',') : []),
    [followingKey],
  )

  const applyEngagement = useCallback(
    (postId: string, patch: { likes?: number; comments?: number }) => {
      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? {
                ...post,
                likes: patch.likes !== undefined ? patch.likes : post.likes,
                comments:
                  patch.comments !== undefined ? patch.comments : post.comments,
              }
            : post,
        ),
      )
      void updateCachedEngagement(postId, patch)
    },
    [],
  )

  const orderPosts = useCallback(
    async (list: FeedPost[]) => {
      if (!viewerPubkey || followingList.length === 0) {
        return sortReelsLatest(list)
      }
      const mutuals = await getMutualPubkeys(viewerPubkey, followingList)
      return prioritizeMutualAuthors(list, mutuals)
    },
    [viewerPubkey, followingList],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cached = await loadCachedPosts()
      if (cached.length > 0) {
        setPosts(await orderPosts(cached))
      }

      const events = await fetchRecentPostEvents()
      await cachePostsFromEvents(events)
      const remote = events
        .map(parseFeedPost)
        .filter((p): p is FeedPost => p !== null)

      const merged = mergePosts(cached, remote)
      const ids = merged.map((p) => p.id)
      const [likes, comments] = await Promise.all([
        fetchLikesFor(ids),
        fetchCommentsFor(ids),
      ])
      const likeCounts = countByTarget(likes, 7)
      const commentCounts = countByTarget(comments, 1)

      const engaged = merged.map((post) => ({
        ...post,
        likes: Math.max(post.likes, likeCounts.get(post.id) ?? 0),
        comments: Math.max(post.comments, commentCounts.get(post.id) ?? 0),
      }))

      setPosts((prev) => {
        const prevById = new Map(prev.map((p) => [p.id, p]))
        const withLocal = engaged.map((post) => {
          const local = prevById.get(post.id)
          return {
            ...post,
            likes: Math.max(post.likes, local?.likes ?? 0),
            comments: Math.max(post.comments, local?.comments ?? 0),
          }
        })
        // orderPosts is async — apply sync mutual sort from last known via void
        return withLocal
      })

      const ordered = await orderPosts(
        engaged.map((post) => {
          // preserve any optimistic engagement already in state when possible
          return post
        }),
      )
      setPosts(ordered)
    } catch (err) {
      const cached = await loadCachedPosts()
      if (cached.length > 0) {
        setPosts(await orderPosts(cached))
        setError('Relays unreachable — showing cached reels')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load reels')
      }
    } finally {
      setLoading(false)
    }
  }, [orderPosts])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return useMemo(
    () => ({ posts, loading, error, refresh, applyEngagement }),
    [posts, loading, error, refresh, applyEngagement],
  )
}
