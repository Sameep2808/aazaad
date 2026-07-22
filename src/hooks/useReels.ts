import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  countByTarget,
  fetchCommentsFor,
  fetchLikesFor,
  fetchRecentPostEventsPage,
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
import { FEED_PAGE_SIZE } from '../lib/relayThrottle'

export interface UseReelsResult {
  posts: FeedPost[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string | null
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
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
 * Paginated Reels — mutual follows first, rate-limited pages.
 */
export function useReels(
  viewerPubkey?: string | null,
  following: string[] = [],
): UseReelsResult {
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const untilRef = useRef<number | null>(null)
  const mutualsRef = useRef<string[]>([])
  const loadingMoreRef = useRef(false)

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
    (list: FeedPost[]) => {
      if (!viewerPubkey || mutualsRef.current.length === 0) {
        return sortReelsLatest(list)
      }
      return prioritizeMutualAuthors(list, mutualsRef.current)
    },
    [viewerPubkey],
  )

  const appendPage = useCallback(
    async (reset: boolean) => {
      const page = await fetchRecentPostEventsPage({
        until: reset ? undefined : untilRef.current ?? undefined,
        limit: FEED_PAGE_SIZE,
      })
      await cachePostsFromEvents(page.events)
      const remote = page.events
        .map(parseFeedPost)
        .filter((p): p is FeedPost => p !== null)

      const ids = remote.map((p) => p.id)
      const [likes, comments] = await Promise.all([
        fetchLikesFor(ids),
        fetchCommentsFor(ids),
      ])
      const likeCounts = countByTarget(likes, 7)
      const commentCounts = countByTarget(comments, 1)
      const engaged = remote.map((post) => ({
        ...post,
        likes: Math.max(post.likes, likeCounts.get(post.id) ?? 0),
        comments: Math.max(post.comments, commentCounts.get(post.id) ?? 0),
      }))

      untilRef.current = page.nextUntil
      setHasMore(!page.exhausted && page.nextUntil != null)

      setPosts((prev) => {
        const merged = reset ? mergePosts(prev, engaged) : mergePosts(prev, engaged)
        const prevById = new Map(prev.map((p) => [p.id, p]))
        const withLocal = merged.map((post) => {
          const local = prevById.get(post.id)
          return {
            ...post,
            likes: Math.max(post.likes, local?.likes ?? 0),
            comments: Math.max(post.comments, local?.comments ?? 0),
          }
        })
        return orderPosts(withLocal)
      })
    },
    [orderPosts],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    untilRef.current = null
    try {
      if (viewerPubkey && followingList.length > 0) {
        mutualsRef.current = await getMutualPubkeys(
          viewerPubkey,
          followingList,
        )
      } else {
        mutualsRef.current = []
      }

      const cached = await loadCachedPosts()
      if (cached.length > 0) {
        setPosts(orderPosts(cached))
      }

      await appendPage(true)
    } catch (err) {
      const cached = await loadCachedPosts()
      if (cached.length > 0) {
        setPosts(orderPosts(cached))
        setError('Relays unreachable — showing cached reels')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load reels')
      }
    } finally {
      setLoading(false)
    }
  }, [viewerPubkey, followingList, orderPosts, appendPage])

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || loading) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      await appendPage(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more reels')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [hasMore, loading, appendPage])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return useMemo(
    () => ({
      posts,
      loading,
      loadingMore,
      hasMore,
      error,
      refresh,
      loadMore,
      applyEngagement,
    }),
    [
      posts,
      loading,
      loadingMore,
      hasMore,
      error,
      refresh,
      loadMore,
      applyEngagement,
    ],
  )
}
