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
} from '../lib/postCache'

export interface UseReelsResult {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/** Newest-first ordering for the Reels swiper. */
export function sortReelsLatest(posts: FeedPost[]): FeedPost[] {
  return [...posts].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

/**
 * Latest media posts for Reels (videos + images), newest first.
 * Merges local cache with relay results so fresh uploads appear immediately.
 */
export function useReels(): UseReelsResult {
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cached = await loadCachedPosts()
      if (cached.length > 0) {
        setPosts(sortReelsLatest(cached))
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

      setPosts(sortReelsLatest(engaged))
    } catch (err) {
      const cached = await loadCachedPosts()
      if (cached.length > 0) {
        setPosts(sortReelsLatest(cached))
        setError('Relays unreachable — showing cached reels')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load reels')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return useMemo(
    () => ({ posts, loading, error, refresh }),
    [posts, loading, error, refresh],
  )
}
