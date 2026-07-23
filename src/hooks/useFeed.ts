import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  countByTarget,
  fetchAuthorsMediaEventsPage,
  fetchCommentsFor,
  fetchLikesFor,
  fetchRepostEventsByAuthorsPage,
  parseFeedPost,
  rankPosts,
  feedItemKey,
  type FeedPost,
} from '../lib/posts'
import {
  cachePostsFromEvents,
  filterFollowingFeed,
  loadCachedPosts,
  updateCachedEngagement,
} from '../lib/postCache'
import { filterOutDeletedPosts, syncDeletionsForAuthors } from '../lib/deletions'
import {
  excludeBlockedPubkeys,
  filterOutBlockedAuthors,
  getBlockedSet,
} from '../lib/blocks'
import {
  loadCachedRepostFeedPosts,
  resolveAndCacheReposts,
} from '../lib/repostCache'
import { FEED_PAGE_SIZE } from '../lib/relayThrottle'
import { useBlockedPubkeys } from './useBlockedPubkeys'

export interface UseFeedResult {
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { blockedKey } = useBlockedPubkeys(viewerPubkey)

  const cursorRef = useRef<{
    until: number | null
    authorChunk: number
    repostAuthorChunk: number
  }>({ until: null, authorChunk: 0, repostAuthorChunk: 0 })
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

  const ingestPage = useCallback(
    async (
      viewer: string,
      allowedAuthors: string[],
      blocked: ReadonlySet<string>,
      reset: boolean,
    ) => {
      const until = reset ? undefined : cursorRef.current.until ?? undefined
      const authorChunk = reset ? 0 : cursorRef.current.authorChunk
      const repostAuthorChunk = reset ? 0 : cursorRef.current.repostAuthorChunk

      const [mediaPage, repostPage] = await Promise.all([
        fetchAuthorsMediaEventsPage({
          authors: allowedAuthors,
          until,
          limit: FEED_PAGE_SIZE,
          authorChunkIndex: authorChunk,
        }),
        fetchRepostEventsByAuthorsPage({
          authors: allowedAuthors,
          until,
          limit: FEED_PAGE_SIZE,
          authorChunkIndex: repostAuthorChunk,
        }),
      ])

      await cachePostsFromEvents(mediaPage.events)
      const remotePosts = filterOutBlockedAuthors(
        await filterOutDeletedPosts(
          mediaPage.events
            .map(parseFeedPost)
            .filter((p): p is FeedPost => p !== null),
        ),
        blocked,
      )
      const remoteReposts = filterOutBlockedAuthors(
        await resolveAndCacheReposts(repostPage.events),
        blocked,
      )

      const safeFollowing = excludeBlockedPubkeys(followingList, blocked)
      const originals = filterFollowingFeed(
        remotePosts,
        viewer,
        safeFollowing,
      )
      const reposts = remoteReposts.filter(
        (p) => p.repost && allowedAuthors.includes(p.repost.pubkey),
      )
      const pageItems = mergeFeedItems(originals, reposts)
      const engaged = await withEngagement(
        await filterOutDeletedPosts(pageItems),
      )
      for (const post of engaged) {
        void updateCachedEngagement(post.id, {
          likes: post.likes,
          comments: post.comments,
        })
      }

      cursorRef.current = {
        until:
          mediaPage.nextAuthorChunk != null ||
          repostPage.nextAuthorChunk != null
            ? (until ?? null)
            : (mediaPage.nextUntil ?? repostPage.nextUntil),
        authorChunk: mediaPage.nextAuthorChunk ?? 0,
        repostAuthorChunk: repostPage.nextAuthorChunk ?? 0,
      }

      const exhausted = mediaPage.exhausted && repostPage.exhausted
      setHasMore(!exhausted)

      setPosts((prev) => {
        const merged = mergeFeedItems(prev, engaged)
        const prevByKey = new Map(prev.map((p) => [feedItemKey(p), p]))
        const withLocal = merged.map((post) => {
          const local = prevByKey.get(feedItemKey(post))
          return {
            ...post,
            likes: Math.max(post.likes, local?.likes ?? 0),
            comments: Math.max(post.comments, local?.comments ?? 0),
          }
        })
        const ranked = rankPosts(filterOutBlockedAuthors(withLocal, blocked))
        void filterOutDeletedPosts(ranked).then((filtered) => {
          if (filtered.length !== ranked.length) setPosts(filtered)
        })
        return ranked
      })

      return engaged.length
    },
    [followingList],
  )

  const refresh = useCallback(async () => {
    if (!viewerPubkey) {
      setPosts([])
      setLoading(false)
      setHasMore(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    cursorRef.current = { until: null, authorChunk: 0, repostAuthorChunk: 0 }

    const blocked = await getBlockedSet(viewerPubkey)
    const safeFollowing = excludeBlockedPubkeys(followingList, blocked)
    const allowedAuthors = [viewerPubkey, ...safeFollowing]

    try {
      await syncDeletionsForAuthors(allowedAuthors)

      const [cachedPosts, cachedReposts] = await Promise.all([
        filterFollowingFeed(
          await loadCachedPosts(),
          viewerPubkey,
          safeFollowing,
        ),
        loadCachedRepostFeedPosts(allowedAuthors),
      ])
      const cachedFeed = filterOutBlockedAuthors(
        mergeFeedItems(cachedPosts, cachedReposts),
        blocked,
      )
      if (cachedFeed.length > 0) {
        setPosts(rankPosts(cachedFeed))
      } else {
        setPosts([])
      }

      await ingestPage(viewerPubkey, allowedAuthors, blocked, true)
    } catch (err) {
      const [cachedPosts, cachedReposts] = await Promise.all([
        filterFollowingFeed(
          await loadCachedPosts(),
          viewerPubkey,
          safeFollowing,
        ),
        loadCachedRepostFeedPosts(allowedAuthors),
      ])
      const cachedFeed = filterOutBlockedAuthors(
        mergeFeedItems(cachedPosts, cachedReposts),
        blocked,
      )
      if (cachedFeed.length > 0) {
        setPosts(rankPosts(cachedFeed))
        setError('Relays unreachable — showing cached following feed')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load feed')
      }
    } finally {
      setLoading(false)
    }
  }, [viewerPubkey, followingList, ingestPage, blockedKey])

  const loadMore = useCallback(async () => {
    if (!viewerPubkey || !hasMore || loadingMoreRef.current || loading) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setError(null)
    try {
      const blocked = await getBlockedSet(viewerPubkey)
      const safeFollowing = excludeBlockedPubkeys(followingList, blocked)
      const allowedAuthors = [viewerPubkey, ...safeFollowing]
      await ingestPage(viewerPubkey, allowedAuthors, blocked, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [viewerPubkey, followingList, hasMore, loading, ingestPage])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    posts,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
    applyEngagement,
  }
}
