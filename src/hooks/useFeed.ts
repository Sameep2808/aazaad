import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  countByTarget,
  fetchAuthorsMediaEvents,
  fetchCommentsFor,
  fetchLikesFor,
  fetchRepostEventsByAuthors,
  parseFeedPost,
  rankPosts,
  feedItemKey,
  type FeedPost,
} from '../lib/posts'
import {
  cachePostsFromEvents,
  filterFollowingFeed,
  loadCachedPosts,
  mergePosts,
  updateCachedEngagement,
} from '../lib/postCache'
import {
  loadCachedRepostFeedPosts,
  resolveAndCacheReposts,
} from '../lib/repostCache'

export interface UseFeedResult {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  applyEngagement: (
    postId: string,
    patch: { likes?: number; comments?: number },
  ) => void
}

async function withEngagement(posts: FeedPost[]): Promise<FeedPost[]> {
  const ids = [...new Set(posts.map((p) => p.id))]
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

function mergeFeedItems(...lists: FeedPost[][]): FeedPost[] {
  const byKey = new Map<string, FeedPost>()
  for (const list of lists) {
    for (const post of list) {
      const key = feedItemKey(post)
      const prev = byKey.get(key)
      if (!prev) {
        byKey.set(key, post)
        continue
      }
      byKey.set(key, {
        ...post,
        likes: Math.max(post.likes, prev.likes),
        comments: Math.max(post.comments, prev.comments),
      })
    }
  }
  return [...byKey.values()]
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
      const [cachedPosts, cachedReposts] = await Promise.all([
        filterFollowingFeed(
          await loadCachedPosts(),
          viewerPubkey,
          followingList,
        ),
        loadCachedRepostFeedPosts(allowedAuthors),
      ])

      const cachedFeed = mergeFeedItems(cachedPosts, cachedReposts)
      if (cachedFeed.length > 0) {
        setPosts(rankPosts(cachedFeed))
      } else {
        setPosts([])
      }

      const [mediaEvents, repostEvents] = await Promise.all([
        fetchAuthorsMediaEvents(allowedAuthors),
        fetchRepostEventsByAuthors(allowedAuthors),
      ])

      const remotePosts = mediaEvents
        .map(parseFeedPost)
        .filter((p): p is FeedPost => p !== null)

      await cachePostsFromEvents(mediaEvents)
      const remoteReposts = await resolveAndCacheReposts(repostEvents)

      const originals = filterFollowingFeed(
        mergePosts(cachedPosts, remotePosts),
        viewerPubkey,
        followingList,
      )

      // Reposts from people you follow (and yourself) — so their followers see them
      const reposts = mergeFeedItems(cachedReposts, remoteReposts).filter(
        (p) => p.repost && allowedAuthors.includes(p.repost.pubkey),
      )

      const merged = mergeFeedItems(originals, reposts)
      const engaged = await withEngagement(merged)
      for (const post of engaged) {
        void updateCachedEngagement(post.id, {
          likes: post.likes,
          comments: post.comments,
        })
      }

      setPosts((prev) => {
        const prevByKey = new Map(prev.map((p) => [feedItemKey(p), p]))
        const mergedEngaged = engaged.map((post) => {
          const local = prevByKey.get(feedItemKey(post))
          return {
            ...post,
            likes: Math.max(post.likes, local?.likes ?? 0),
            comments: Math.max(post.comments, local?.comments ?? 0),
          }
        })
        return rankPosts(mergedEngaged)
      })
    } catch (err) {
      const [cachedPosts, cachedReposts] = await Promise.all([
        filterFollowingFeed(
          await loadCachedPosts(),
          viewerPubkey,
          followingList,
        ),
        loadCachedRepostFeedPosts(allowedAuthors),
      ])
      const cachedFeed = mergeFeedItems(cachedPosts, cachedReposts)
      if (cachedFeed.length > 0) {
        setPosts(rankPosts(cachedFeed))
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
