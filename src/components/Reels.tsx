import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Heart, MessageCircle, PlusSquare, Radio, Repeat2, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useIPFSSeed } from '../hooks/useIPFSSeed'
import {
  useOptimisticEngagement,
  type EngageHandler,
} from '../hooks/useOptimisticEngagement'
import { useProfiles } from '../hooks/useProfiles'
import { useRepost } from '../hooks/useRepost'
import { feedItemKey, type FeedPost } from '../lib/posts'
import type { ResolvedProfile } from '../lib/profiles'
import { displayHandle } from '../lib/profiles'
import { profilePath } from '../lib/userSearch'
import { AutoMedia, type AutoMediaHandle } from './AutoMedia'
import { DoubleTapLikeLayer } from './DoubleTapLikeLayer'
import { PostAuthorBar } from './UserAvatar'
import { ShareSheet } from './ShareSheet'

interface ReelsProps {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onEngage?: EngageHandler
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

function ReelSlide({
  post,
  root,
  profile,
  reposterProfile,
  onEngage,
}: {
  post: FeedPost
  root: Element | null
  profile?: ResolvedProfile | null
  reposterProfile?: ResolvedProfile | null
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
  const [showComment, setShowComment] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

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
    try {
      const result = await toggleSeed(post.cid)
      setMsg(result === 'seeded' ? 'Seeding' : 'Stopped seeding')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Seed failed')
    }
  }

  const alreadyReposted = isReposted(post.id)
  const seeded = isSeeded(post.cid)
  const seedBusy = seedBusyCid === post.cid

  return (
    <section className="relative h-full w-full bg-black">
      <DoubleTapLikeLayer
        className="absolute inset-0 h-full w-full"
        onLike={onDoubleTapLike}
        onSingleTap={onSingleTapMedia}
      >
        <AutoMedia
          ref={mediaRef}
          post={post}
          variant="reel"
          root={root}
          className="h-full w-full"
        />
      </DoubleTapLikeLayer>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-4 pb-20 pt-24">
        {post.repost && (
          <p className="pointer-events-auto mb-1 flex items-center gap-1 text-xs font-medium text-white/70">
            <Repeat2 className="h-3.5 w-3.5" />
            <Link
              to={profilePath(post.repost.pubkey)}
              className="truncate font-medium text-white active:opacity-80"
              onClick={(e) => e.stopPropagation()}
            >
              {displayHandle(
                reposterProfile ?? {
                  pubkey: post.repost.pubkey,
                  username: null,
                  displayName: null,
                  pictureUrl: null,
                  pictureCid: null,
                },
              )}
            </Link>{' '}
            reposted
          </p>
        )}
        <div className="pointer-events-auto mb-2 max-w-[75%]">
          <PostAuthorBar profile={profile} pubkey={post.pubkey} variant="reel" />
        </div>
        {post.caption && (
          <p className="pointer-events-auto max-w-[75%] text-sm text-white drop-shadow">
            {post.caption}
          </p>
        )}
        {msg && <p className="mt-1 text-xs text-white/70">{msg}</p>}
      </div>

      <div className="absolute bottom-24 right-3 z-10 flex flex-col items-center gap-4">
        <button
          type="button"
          disabled={likeBusy}
          onClick={() => void like()}
          className={[
            'flex touch-manipulation flex-col items-center gap-1 active:opacity-70',
            liked ? 'text-red-400' : 'text-white',
          ].join(' ')}
          aria-pressed={liked}
        >
          <span className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
            <Heart className="h-7 w-7" fill={liked ? 'currentColor' : 'none'} />
          </span>
          <span className="text-xs font-medium">{likes}</span>
        </button>

        <button
          type="button"
          onClick={() => setShowComment((v) => !v)}
          className="flex touch-manipulation flex-col items-center gap-1 text-white active:opacity-70"
        >
          <span className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
            <MessageCircle className="h-7 w-7" />
          </span>
          <span className="text-xs font-medium">{comments}</span>
        </button>

        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="flex touch-manipulation flex-col items-center gap-1 text-white active:opacity-70"
          aria-label="Share post"
        >
          <span className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
            <Send className="h-7 w-7" />
          </span>
          <span className="text-[10px] font-medium">Share</span>
        </button>

        <button
          type="button"
          disabled={busyId === post.id}
          onClick={() => {
            void toggleRepost(post).then((result) => {
              if (result === 'reposted') {
                noteSeeded(post.cid)
                void hydrateSeed([post.cid])
                setMsg('Reposted · seeding')
              } else if (result === 'unreposted') {
                setMsg('Removed repost')
              }
            })
          }}
          className={[
            'flex touch-manipulation flex-col items-center gap-1 disabled:opacity-50 active:opacity-70',
            alreadyReposted ? 'text-emerald-400' : 'text-white',
          ].join(' ')}
          aria-pressed={alreadyReposted}
        >
          <span className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
            <Repeat2 className="h-7 w-7" />
          </span>
          <span className="text-[10px] font-medium">
            {alreadyReposted ? 'Reposted' : 'Repost'}
          </span>
        </button>

        <button
          type="button"
          disabled={seedBusy}
          onClick={() => void onToggleSeed()}
          className={[
            'flex touch-manipulation flex-col items-center gap-1 disabled:opacity-50 active:opacity-70',
            seeded ? 'text-emerald-300' : 'text-white',
          ].join(' ')}
          aria-pressed={seeded}
        >
          <span className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
            <Radio className="h-7 w-7" />
          </span>
          <span className="text-[10px] font-medium">
            {seedBusy ? '…' : seeded ? 'Seeding' : 'Seed'}
          </span>
        </button>
      </div>

      {showComment && (
        <div className="absolute inset-x-0 bottom-16 z-20 flex gap-2 bg-black/80 px-3 py-2 backdrop-blur-md">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment…"
            className="min-h-11 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
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
            className="min-h-11 touch-manipulation rounded-full bg-white px-4 text-xs font-semibold text-zinc-900"
          >
            Post
          </button>
        </div>
      )}

      <ShareSheet
        post={post}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onShared={(count) =>
          setMsg(count === 1 ? 'Sent to 1 person' : `Sent to ${count} people`)
        }
      />
    </section>
  )
}

export function Reels({
  posts,
  loading,
  error,
  onRefresh,
  onEngage,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: ReelsProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [root, setRoot] = useState<Element | null>(null)
  const pubkeys = useMemo(() => {
    const ids: string[] = []
    for (const p of posts) {
      ids.push(p.pubkey)
      if (p.repost?.pubkey) ids.push(p.repost.pubkey)
    }
    return ids
  }, [posts])
  const { get: getProfile } = useProfiles(pubkeys)

  useEffect(() => {
    setRoot(scrollerRef.current)
  }, [])

  // Prefetch next page when near the last couple reels
  useEffect(() => {
    const rootEl = scrollerRef.current
    if (!rootEl || !onLoadMore || !hasMore) return

    const onScroll = () => {
      const slides = rootEl.children.length
      if (slides === 0) return
      const index = Math.round(rootEl.scrollTop / rootEl.clientHeight)
      if (index >= slides - 2 && !loadingMore) onLoadMore()
    }
    rootEl.addEventListener('scroll', onScroll, { passive: true })
    return () => rootEl.removeEventListener('scroll', onScroll)
  }, [onLoadMore, hasMore, loadingMore, posts.length])

  if (loading && posts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        Loading reels…
      </div>
    )
  }

  if (posts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-zinc-300">No reels yet</p>
        <p className="text-xs text-zinc-500">
          Upload a photo or video — it will show up here instantly.
        </p>
        <Link
          to="/upload"
          className="min-h-11 touch-manipulation rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900"
        >
          Create
        </Link>
        {error && <p className="text-xs text-amber-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-black">
      <div
        className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-2"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <Link
          to="/upload"
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-white drop-shadow active:bg-white/10"
          aria-label="Create post"
        >
          <PlusSquare className="h-6 w-6" strokeWidth={1.75} />
        </Link>
        <h1 className="text-sm font-semibold text-white drop-shadow">Reels</h1>
        <button
          type="button"
          onClick={onRefresh}
          className="min-h-11 touch-manipulation px-3 text-xs text-white/70 underline"
        >
          Refresh
        </button>
      </div>
      {error && (
        <p className="absolute inset-x-0 top-14 z-20 px-4 text-center text-[11px] text-amber-300">
          {error}
        </p>
      )}

      <div
        ref={scrollerRef}
        className="scroll-touch h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain"
        style={{
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        {posts.map((post) => (
          <div
            key={feedItemKey(post)}
            className="h-full w-full shrink-0 snap-start snap-always"
          >
            <ReelSlide
              post={post}
              root={root}
              profile={getProfile(post.pubkey)}
              reposterProfile={
                post.repost ? getProfile(post.repost.pubkey) : undefined
              }
              onEngage={onEngage}
            />
          </div>
        ))}
      </div>
      {loadingMore && (
        <p className="pointer-events-none absolute inset-x-0 bottom-16 z-20 text-center text-[11px] text-white/70">
          Loading more…
        </p>
      )}
    </div>
  )
}
