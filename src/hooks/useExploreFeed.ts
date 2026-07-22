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
import { getMutualPubkeys, prioritizeMutualAuthors } from '../lib/mutuals'

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
 * Explore feed: mutual follows first, then discovery (followers of people you follow).
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
      const mutuals = await getMutualPubkeys(viewerPubkey, followingList)
      const mutualSet = new Set(mutuals)

      const discovered = await discoverFollowersOfFollowing(
        viewerPubkey,
        followingList,
      )
      // Remaining = discovery authors not already mutual; also include
      // non-mutual people you follow so Explore isn't empty of close ties.
      const nonMutualFollowing = followingList.filter(
        (pk) => !mutualSet.has(pk),
      )
      const remaining = [
        ...nonMutualFollowing,
        ...discovered.filter((pk) => !mutualSet.has(pk)),
      ]
      const authorList = [...new Set([...mutuals, ...remaining])]
      setAuthors(authorList)

      if (authorList.length === 0) {
        setPosts([])
        return
      }

      const events = await fetchAuthorsMediaEvents(authorList)
      await cachePostsFromEvents(events)
      const parsed = events
        .map(parseFeedPost)
        .filter((p): p is FeedPost => p !== null)
      const withCounts = await withEngagement(parsed)
      const ranked = rankPosts(mergePosts(withCounts))
      setPosts(prioritizeMutualAuthors(ranked, mutuals, (a, b) => b.score - a.score || b.createdAt - a.createdAt))
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
