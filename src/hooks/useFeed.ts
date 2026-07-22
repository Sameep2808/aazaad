import { useCallback, useEffect, useState } from 'react'
import {
  countByTarget,
  fetchCommentsFor,
  fetchLikesFor,
  fetchRecentPostEvents,
  parseFeedPost,
  rankPosts,
  type FeedPost,
} from '../lib/posts'
import {
  cachePostsFromEvents,
  loadCachedPosts,
  mergePosts,
} from '../lib/postCache'

export interface UseFeedResult {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

async function withEngagement(posts: FeedPost[]): Promise<FeedPost[]> {
  const ids = posts.map((p) => p.id)
  const [likes, comments] = await Promise.all([
    fetchLikesFor(ids),
    fetchCommentsFor(ids),
  ])
  const likeCounts = countByTarget(likes, 7)
  const commentCounts = countByTarget(comments, 1)

  return posts.map((post) => ({
    ...post,
    likes: Math.max(post.likes, likeCounts.get(post.id) ?? 0),
    comments: Math.max(post.comments, commentCounts.get(post.id) ?? 0),
  }))
}

export function useFeed(): UseFeedResult {
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Show cached media posts immediately (includes posts you just made)
      const cached = await loadCachedPosts()
      if (cached.length > 0) {
        setPosts(rankPosts(cached))
      }

      const events = await fetchRecentPostEvents()
      const remote = events
        .map(parseFeedPost)
        .filter((p): p is FeedPost => p !== null)

      // Persist relay posts locally so Home stays populated offline
      await cachePostsFromEvents(events)

      const merged = mergePosts(cached, remote)
      const engaged = await withEngagement(merged)
      setPosts(rankPosts(engaged))
    } catch (err) {
      // If relays fail, keep showing whatever we already cached
      const cached = await loadCachedPosts()
      if (cached.length > 0) {
        setPosts(rankPosts(cached))
        setError('Relays unreachable — showing cached posts')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load feed')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { posts, loading, error, refresh }
}
