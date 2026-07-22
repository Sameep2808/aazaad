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
import { cachePostsFromEvents, mergePosts } from '../lib/postCache'
import { discoverFollowersOfFollowing } from '../lib/exploreDiscovery'

async function withEngagement(posts: FeedPost[]): Promise<FeedPost[]> {
  const ids = [...new Set(posts.map((p) => p.id))]
  if (ids.length === 0) return posts
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

/**
 * Explore discovery feed: posts from people who follow accounts you follow.
 */
export function useExploreFeed(
  viewerPubkey: string | null | undefined,
  following: string[],
) {
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [authors, setAuthors] = useState<string[]>([])
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
                  patch.comments !== undefined
                    ? patch.comments
                    : post.comments,
              }
            : post,
        ),
      )
    },
    [],
  )

  const refresh = useCallback(async () => {
    if (!viewerPubkey) {
      setPosts([])
      setAuthors([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const discovered = await discoverFollowersOfFollowing(
        viewerPubkey,
        followingList,
      )
      setAuthors(discovered)

      if (discovered.length === 0) {
        setPosts([])
        return
      }

      const events = await fetchAuthorsMediaEvents(discovered)
      await cachePostsFromEvents(events)
      const parsed = events
        .map(parseFeedPost)
        .filter((p): p is FeedPost => p !== null)
      const withCounts = await withEngagement(parsed)
      setPosts(rankPosts(mergePosts(withCounts)))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load explore posts',
      )
    } finally {
      setLoading(false)
    }
  }, [viewerPubkey, followingList])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    posts,
    authors,
    loading,
    error,
    refresh,
    applyEngagement,
  }
}
