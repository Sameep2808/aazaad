import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  countByTarget,
  fetchAuthorsMediaEvents,
  fetchCommentsFor,
  fetchLikesFor,
  parseFeedPost,
  rankPosts,
  type FeedPost,
} from '../lib/posts'
import {
  cachePostsFromEvents,
  filterFollowingFeed,
  loadCachedPosts,
  mergePosts,
  updateCachedEngagement,
} from '../lib/postCache'

export interface UseFeedResult {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  /** Instant local engagement update (likes/comments) without waiting on relays */
  applyEngagement: (
    postId: string,
    patch: { likes?: number; comments?: number },
  ) => void
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

export function useFeed(
  viewerPubkey: string | null | undefined,
  following: string[],
): UseFeedResult {
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

  const refresh = useCallback(async () => {
    if (!viewerPubkey) {
      setPosts([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    const allowedAuthors = [viewerPubkey, ...followingList]

    try {
      const cached = filterFollowingFeed(
        await loadCachedPosts(),
        viewerPubkey,
        followingList,
      )
      if (cached.length > 0) {
        setPosts(rankPosts(cached))
      } else {
        setPosts([])
      }

      const events = await fetchAuthorsMediaEvents(allowedAuthors)
      const remote = events
        .map(parseFeedPost)
        .filter((p): p is FeedPost => p !== null)

      await cachePostsFromEvents(events)

      const merged = filterFollowingFeed(
        mergePosts(cached, remote),
        viewerPubkey,
        followingList,
      )
      const engaged = await withEngagement(merged)
      for (const post of engaged) {
        void updateCachedEngagement(post.id, {
          likes: post.likes,
          comments: post.comments,
        })
      }
      setPosts((prev) => {
        const prevById = new Map(prev.map((p) => [p.id, p]))
        const mergedEngaged = engaged.map((post) => {
          const local = prevById.get(post.id)
          return {
            ...post,
            likes: Math.max(post.likes, local?.likes ?? 0),
            comments: Math.max(post.comments, local?.comments ?? 0),
          }
        })
        return rankPosts(mergedEngaged)
      })
    } catch (err) {
      const cached = filterFollowingFeed(
        await loadCachedPosts(),
        viewerPubkey,
        followingList,
      )
      if (cached.length > 0) {
        setPosts(rankPosts(cached))
        setError('Relays unreachable — showing cached following feed')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load feed')
      }
    } finally {
      setLoading(false)
    }
  }, [viewerPubkey, followingList])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { posts, loading, error, refresh, applyEngagement }
}
