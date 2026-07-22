import { useCallback, useEffect, useState } from 'react'
import {
  countByTarget,
  fetchAuthorMediaEvents,
  fetchCommentsFor,
  fetchLikesFor,
  parseFeedPost,
  type FeedPost,
} from '../lib/posts'
import {
  cachePostsFromEvents,
  loadCachedPostsByAuthor,
  mergePosts,
} from '../lib/postCache'

export interface UseUserPostsResult {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * All media posts by a given author — local cache + relays.
 * Used for the Instagram-style profile grid.
 */
export function useUserPosts(pubkey: string | null | undefined): UseUserPostsResult {
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!pubkey) {
      setPosts([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const cached = await loadCachedPostsByAuthor(pubkey)
      if (cached.length > 0) {
        setPosts(cached)
      }

      const events = await fetchAuthorMediaEvents(pubkey)
      await cachePostsFromEvents(events)
      const remote = events
        .map(parseFeedPost)
        .filter((p): p is FeedPost => p !== null)

      const merged = mergePosts(cached, remote).sort(
        (a, b) => b.createdAt - a.createdAt,
      )

      const ids = merged.map((p) => p.id)
      const [likes, comments] = await Promise.all([
        fetchLikesFor(ids),
        fetchCommentsFor(ids),
      ])
      const likeCounts = countByTarget(likes, 7)
      const commentCounts = countByTarget(comments, 1)

      setPosts(
        merged.map((post) => ({
          ...post,
          likes: Math.max(post.likes, likeCounts.get(post.id) ?? 0),
          comments: Math.max(post.comments, commentCounts.get(post.id) ?? 0),
        })),
      )
    } catch (err) {
      const cached = await loadCachedPostsByAuthor(pubkey)
      if (cached.length > 0) {
        setPosts(cached)
        setError('Relays unreachable — showing your cached posts')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load posts')
      }
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { posts, loading, error, refresh }
}
