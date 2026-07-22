import { useCallback, useEffect, useState } from 'react'
import {
  fetchCommentsFor,
  fetchLikesFor,
  fetchRepostEventsByAuthors,
  countByTarget,
  type FeedPost,
} from '../lib/posts'
import {
  loadCachedRepostsByAuthor,
  resolveAndCacheReposts,
} from '../lib/repostCache'

export interface UseUserRepostsResult {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/** Media posts this user has reposted (Kind 6). */
export function useUserReposts(
  pubkey: string | null | undefined,
): UseUserRepostsResult {
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
      const cached = await loadCachedRepostsByAuthor(pubkey)
      if (cached.length > 0) {
        setPosts(cached)
      }

      const events = await fetchRepostEventsByAuthors([pubkey])
      const hydrated = await resolveAndCacheReposts(events)
      const mine = hydrated
        .filter((p) => p.repost?.pubkey === pubkey)
        .sort(
          (a, b) =>
            (b.repost?.createdAt ?? 0) - (a.repost?.createdAt ?? 0),
        )

      const ids = mine.map((p) => p.id)
      const [likes, comments] = await Promise.all([
        fetchLikesFor(ids),
        fetchCommentsFor(ids),
      ])
      const likeCounts = countByTarget(likes, 7)
      const commentCounts = countByTarget(comments, 1)

      setPosts(
        mine.map((post) => ({
          ...post,
          likes: Math.max(post.likes, likeCounts.get(post.id) ?? 0),
          comments: Math.max(post.comments, commentCounts.get(post.id) ?? 0),
        })),
      )
    } catch (err) {
      const cached = await loadCachedRepostsByAuthor(pubkey)
      if (cached.length > 0) {
        setPosts(cached)
        setError('Relays unreachable — showing cached reposts')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load reposts')
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
