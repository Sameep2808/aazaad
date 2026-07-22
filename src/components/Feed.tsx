import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Heart, MessageCircle, Radio, Repeat2 } from 'lucide-react'
import { useIPFSSeed } from '../hooks/useIPFSSeed'
import {
  useOptimisticEngagement,
  type EngageHandler,
} from '../hooks/useOptimisticEngagement'
import { useProfiles } from '../hooks/useProfiles'
import { useRepost } from '../hooks/useRepost'
import { useNearEndScroll } from '../hooks/useNearEndScroll'
import { feedItemKey, type FeedPost } from '../lib/posts'
import type { ResolvedProfile } from '../lib/profiles'
import { displayHandle } from '../lib/profiles'
import { AutoMedia, type AutoMediaHandle } from './AutoMedia'
import { DoubleTapLikeLayer } from './DoubleTapLikeLayer'
import { PostAuthorBar } from './UserAvatar'

interface FeedProps {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onEngage?: EngageHandler
  compact?: boolean
  emptyMessage?: string
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

export { AutoMedia as MediaPlayer } from './AutoMedia'

export function PostCard({
  post,
  profile,
  reposterProfile,
  onEngage,
}: {
  post: FeedPost
  profile?: ResolvedProfile | null
  reposterProfile?: ResolvedProfile | null
  onChanged?: () => void
  onEngage?: EngageHandler
}) {
  const {
    toggleSeed,
    busyCid: seedBusyCid,
    error: seedError,
    isSeeded,
    hydrate: hydrateSeed,
    noteSeeded,
  } = useIPFSSeed()
  const {
    likes,
    comments,
    liked,
    likeBusy,
    busy,
    error,
    like,
    likeOnly,
    comment,
  } = useOptimisticEngagement(post, onEngage)
  const { toggleRepost, busyId, error: repostError, isReposted, hydrate } =
    useRepost()
  const mediaRef = useRef<AutoMediaHandle>(null)
  const [commentText, setCommentText] = useState('')
  const [showComment, setShowComment] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (error) setMsg(error)
  }, [error])

  useEffect(() => {
    if (repostError) setMsg(repostError)
  }, [repostError])

  useEffect(() => {
    if (seedError) setMsg(seedError)
  }, [seedError])

  useEffect(() => {
    void hydrate([post.id])
    void hydrateSeed([post.cid])
  }, [post.id, post.cid, hydrate, hydrateSeed])

  const onDoubleTapLike = useCallback(() => {
    void likeOnly()
  }, [likeOnly])

  const onSingleTapMedia = useCallback(() => {
    mediaRef.current?.togglePlayPause()
  }, [])

  async function onToggleSeed() {
    setMsg(null)
    try {
      const result = await toggleSeed(post.cid)
      setMsg(
        result === 'seeded'
          ? 'Seeding this post from your device'
          : 'Stopped seeding this post',
      )
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Seed failed')
    }
  }

  const alreadyReposted = isReposted(post.id)
  const seeded = isSeeded(post.cid)
  const seedBusy = seedBusyCid === post.cid

  return (
    <article className="border-b border-zinc-800 pb-4">
      {post.repost && (
        <div className="flex items-center gap-1.5 px-4 pt-2 text-xs font-medium text-zinc-400">
          <Repeat2 className="h-3.5 w-3.5" />
          <span>
            {displayHandle(
              reposterProfile ?? {
                pubkey: post.repost.pubkey,
                username: null,
                displayName: null,
                pictureUrl: null,
                pictureCid: null,
              },
            )}{' '}
            reposted
          </span>
        </div>
      )}
      <PostAuthorBar profile={profile} pubkey={post.pubkey} variant="feed" />
      <DoubleTapLikeLayer
        onLike={onDoubleTapLike}
        onSingleTap={
          post.mediaType === 'video' ? onSingleTapMedia : undefined
        }
      >
        <AutoMedia ref={mediaRef} post={post} variant="feed" />
      </DoubleTapLikeLayer>
      <div className="space-y-2 px-4 pt-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={likeBusy}
            onClick={() => void like()}
            className={[
              'flex min-h-11 min-w-11 touch-manipulation items-center gap-1.5 px-2 text-sm active:opacity-70',
              liked ? 'text-red-400' : 'text-zinc-200',
            ].join(' ')}
            aria-pressed={liked}
          >
            <Heart
              className="h-6 w-6"
              fill={liked ? 'currentColor' : 'none'}
            />
            {likes}
          </button>
          <button
            type="button"
            onClick={() => setShowComment((v) => !v)}
            className="flex min-h-11 min-w-11 touch-manipulation items-center gap-1.5 px-2 text-sm text-zinc-200 active:opacity-70"
          >
            <MessageCircle className="h-6 w-6" />
            {comments}
          </button>
          <button
            type="button"
            disabled={busyId === post.id}
            onClick={() => {
              void toggleRepost(post).then((result) => {
                if (result === 'reposted') {
                  noteSeeded(post.cid)
                  void hydrateSeed([post.cid])
                  setMsg('Reposted — auto-seeding this post')
                } else if (result === 'unreposted') {
                  setMsg('Removed repost')
                }
              })
            }}
            className={[
              'flex min-h-11 touch-manipulation items-center gap-1.5 px-2 text-sm disabled:opacity-50 active:opacity-70',
              alreadyReposted ? 'text-emerald-400' : 'text-zinc-200',
            ].join(' ')}
            aria-pressed={alreadyReposted}
          >
            <Repeat2 className="h-6 w-6" />
            {busyId === post.id
              ? '…'
              : alreadyReposted
                ? 'Reposted'
                : 'Repost'}
          </button>
          <button
            type="button"
            disabled={seedBusy}
            onClick={() => void onToggleSeed()}
            className={[
              'ml-auto flex min-h-11 touch-manipulation items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50',
              seeded
                ? 'border-emerald-500/80 bg-emerald-900/50 text-emerald-300'
                : 'border-zinc-700 bg-zinc-900/60 text-zinc-300',
            ].join(' ')}
            aria-pressed={seeded}
          >
            <Radio className="h-3.5 w-3.5" />
            {seedBusy ? '…' : seeded ? 'Seeding' : 'Seed'}
          </button>
        </div>

        {post.caption && (
          <p className="allow-select whitespace-pre-wrap text-sm text-zinc-200">
            {profile?.username && (
              <span className="mr-1.5 font-semibold">@{profile.username}</span>
            )}
            {post.caption}
          </p>
        )}

        {showComment && (
          <div className="flex gap-2">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment…"
              className="min-h-11 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void comment(commentText).then((ok) => {
                  if (ok) {
                    setCommentText('')
                    setShowComment(false)
                  }
                })
              }}
              className="min-h-11 touch-manipulation rounded-lg bg-white px-3 py-2 text-xs font-semibold text-zinc-900"
            >
              Post
            </button>
          </div>
        )}

        {msg && <p className="text-xs text-zinc-400">{msg}</p>}
      </div>
    </article>
  )
}

export function Feed({
  posts,
  loading,
  error,
  onRefresh,
  onEngage,
  compact = false,
  emptyMessage = 'No posts from people you follow yet.',
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: FeedProps) {
  const pubkeys = useMemo(() => {
    const ids: string[] = []
    for (const p of posts) {
      ids.push(p.pubkey)
      if (p.repost?.pubkey) ids.push(p.repost.pubkey)
    }
    return ids
  }, [posts])
  const { get: getProfile } = useProfiles(pubkeys)

  const handleNearEnd = useCallback(() => {
    if (hasMore && !loadingMore && onLoadMore) onLoadMore()
  }, [hasMore, loadingMore, onLoadMore])
  const sentinelRef = useNearEndScroll(handleNearEnd, {
    enabled: Boolean(onLoadMore) && hasMore,
  })

  if (loading && posts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading feed…
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      {!compact && (
        <div className="flex items-center justify-between px-4 py-2">
          <p className="text-xs text-zinc-500">{posts.length} posts</p>
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-11 touch-manipulation px-2 text-xs text-zinc-400 underline"
          >
            Refresh
          </button>
        </div>
      )}
      {error && <p className="px-4 text-sm text-amber-400">{error}</p>}
      {posts.length === 0 && !loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <p className="text-sm text-zinc-400">{emptyMessage}</p>
          <p className="text-xs text-zinc-600">
            Your posts, reposts from people you follow, and their posts show up
            here.
          </p>
        </div>
      ) : (
        posts.map((post) => (
          <PostCard
            key={feedItemKey(post)}
            post={post}
            profile={getProfile(post.pubkey)}
            reposterProfile={
              post.repost ? getProfile(post.repost.pubkey) : undefined
            }
            onEngage={onEngage}
          />
        ))
      )}
      <div ref={sentinelRef} className="h-8 w-full" aria-hidden />
      {loadingMore && (
        <p className="py-3 text-center text-xs text-zinc-500">Loading more…</p>
      )}
      {!hasMore && posts.length > 0 && (
        <p className="py-3 text-center text-[10px] text-zinc-600">End of feed</p>
      )}
    </div>
  )
}
