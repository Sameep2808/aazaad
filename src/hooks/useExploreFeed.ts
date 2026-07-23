import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  countByTarget,
  fetchAuthorsMediaEventsPage,
  fetchCommentsFor,
  fetchLikesFor,
  parseFeedPost,
  rankPosts,
  type FeedPost,
} from '../lib/posts'
import { cachePostsFromEvents, mergePosts } from '../lib/postCache'
import { filterOutDeletedPosts, syncDeletionsForAuthors } from '../lib/deletions'
import {
  excludeBlockedPubkeys,
  filterOutBlockedAuthors,
  getBlockedSet,
} from '../lib/blocks'
import { discoverFollowersOfFollowing } from '../lib/exploreDiscovery'
import { getMutualPubkeys, prioritizeMutualAuthors } from '../lib/mutuals'
import { FEED_PAGE_SIZE } from '../lib/relayThrottle'
import { useBlockedPubkeys } from './useBlockedPubkeys'

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
 * Explore feed with rate-limited pagination: mutuals first, then discovery.
 */
export function useExploreFeed(
  viewerPubkey: string | null | undefined,
  following: string[],
) {
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [authors, setAuthors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { blockedKey } = useBlockedPubkeys(viewerPubkey)

  const cursorRef = useRef<{ until: number | null; authorChunk: number }>({
    until: null,
    authorChunk: 0,
  })
  const mutualsRef = useRef<string[]>([])
  const authorsRef = useRef<string[]>([])
  const blockedRef = useRef<Set<string>>(new Set())
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

  const ingestPage = useCallback(async (reset: boolean) => {
    const page = await fetchAuthorsMediaEventsPage({
      authors: authorsRef.current,
      until: reset ? undefined : cursorRef.current.until ?? undefined,
      limit: FEED_PAGE_SIZE,
      authorChunkIndex: reset ? 0 : cursorRef.current.authorChunk,
    })
    await cachePostsFromEvents(page.events)
    const parsed = filterOutBlockedAuthors(
      await filterOutDeletedPosts(
        page.events
          .map(parseFeedPost)
          .filter((p): p is FeedPost => p !== null),
      ),
      blockedRef.current,
    )
    const withCounts = await withEngagement(parsed)

    cursorRef.current = {
      until: page.nextUntil,
      authorChunk: page.nextAuthorChunk ?? 0,
    }
    setHasMore(!page.exhausted)

    setPosts((prev) => {
      const merged = mergePosts(prev, withCounts)
      const ranked = rankPosts(
        filterOutBlockedAuthors(merged, blockedRef.current),
      )
      return prioritizeMutualAuthors(
        ranked,
        mutualsRef.current,
        (a, b) => b.score - a.score || b.createdAt - a.createdAt,
      )
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!viewerPubkey) {
      setPosts([])
      setAuthors([])
      setHasMore(false)
      return
    }

    setLoading(true)
    setError(null)
    cursorRef.current = { until: null, authorChunk: 0 }
    try {
      const blocked = await getBlockedSet(viewerPubkey)
      blockedRef.current = blocked
      const safeFollowing = excludeBlockedPubkeys(followingList, blocked)

      const mutuals = await getMutualPubkeys(viewerPubkey, safeFollowing)
      mutualsRef.current = mutuals
      const mutualSet = new Set(mutuals)

      const discovered = await discoverFollowersOfFollowing(
        viewerPubkey,
        safeFollowing,
      )
      const nonMutualFollowing = safeFollowing.filter(
        (pk) => !mutualSet.has(pk),
      )
      const remaining = [
        ...nonMutualFollowing,
        ...discovered.filter((pk) => !mutualSet.has(pk)),
      ]
      const authorList = excludeBlockedPubkeys(
        [...new Set([...mutuals, ...remaining])],
        blocked,
      )
      authorsRef.current = authorList
      setAuthors(authorList)

      if (authorList.length === 0) {
        setPosts([])
        setHasMore(false)
        return
      }

      await syncDeletionsForAuthors(authorList)

      setPosts([])
      await ingestPage(true)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load explore posts',
      )
    } finally {
      setLoading(false)
    }
  }, [viewerPubkey, followingList, ingestPage, blockedKey])

  const loadMore = useCallback(async () => {
    if (!viewerPubkey || !hasMore || loadingMoreRef.current || loading) return
    if (authorsRef.current.length === 0) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      await ingestPage(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [viewerPubkey, hasMore, loading, ingestPage])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    posts,
    authors,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
    applyEngagement,
  }
}
