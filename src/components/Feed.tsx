import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, MessageCircle, MoreHorizontal, Radio, Repeat2, Send, ShieldBan, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useIPFSSeed } from '../hooks/useIPFSSeed'
import {
  useOptimisticEngagement,
  type EngageHandler,
} from '../hooks/useOptimisticEngagement'
import { useProfiles } from '../hooks/useProfiles'
import { useRepost } from '../hooks/useRepost'
import { useNearEndScroll } from '../hooks/useNearEndScroll'
import { blockUser } from '../lib/blocks'
import { deleteOwnPost } from '../lib/deletions'
import { db } from '../lib/db'
import {
  buildContactListEvent,
  publishEvent,
} from '../lib/nostr'
import { feedItemKey, type FeedPost } from '../lib/posts'
import type { ResolvedProfile } from '../lib/profiles'
import { displayHandle } from '../lib/profiles'
import { profilePath } from '../lib/userSearch'
import { AutoMedia, type AutoMediaHandle } from './AutoMedia'
import { DoubleTapLikeLayer } from './DoubleTapLikeLayer'
import { PostAuthorBar } from './UserAvatar'
import { ShareSheet } from './ShareSheet'

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
  onChanged,
  onEngage,
}: {
  post: FeedPost
  profile?: ResolvedProfile | null
  reposterProfile?: ResolvedProfile | null
  onChanged?: () => void
  onEngage?: EngageHandler
}) {
  const { pubkey, signEvent } = useAuth()
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  const isOwnPost = Boolean(pubkey && post.pubkey === pubkey && !post.repost)
  const canBlockAuthor = Boolean(pubkey && post.pubkey !== pubkey)
  const showMenu = isOwnPost || canBlockAuthor

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

  async function onDeletePost() {
    if (!pubkey || !isOwnPost || deleting) return
    const ok = window.confirm(
      'Delete this post? It will be removed from this app and a delete request will be sent to relays.',
    )
    if (!ok) return
    setDeleting(true)
    setMsg(null)
    setMenuOpen(false)
    try {
      await deleteOwnPost({
        postId: post.id,
        pubkey,
        signEvent,
      })
      onChanged?.()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed to delete post')
    } finally {
      setDeleting(false)
    }
  }

  async function onBlockAuthor() {
    if (!pubkey || !canBlockAuthor || blocking) return
    const ok = window.confirm(
      'Block this user? Their posts will be hidden from Home, Explore, and Reels.',
    )
    if (!ok) return
    setBlocking(true)
    setMsg(null)
    setMenuOpen(false)
    try {
      // Best-effort unfollow so Home allowlist drops them too
      const cached = await db.follows.get(pubkey)
      if (cached?.following.includes(post.pubkey)) {
        const list = cached.following.filter((pk) => pk !== post.pubkey)
        const signed = await signEvent(buildContactListEvent(list))
        await db.follows.put({
          pubkey,
          following: list,
          updatedAt: Date.now(),
        })
        void publishEvent(signed)
      }
      await blockUser(pubkey, post.pubkey)
      onChanged?.()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed to block user')
    } finally {
      setBlocking(false)
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
          <Link
            to={profilePath(post.repost.pubkey)}
            className="truncate font-medium text-zinc-300 active:opacity-80"
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
          </Link>
          <span>reposted</span>
        </div>
      )}
      <div className="relative flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <PostAuthorBar profile={profile} pubkey={post.pubkey} variant="feed" />
        </div>
        {showMenu && (
          <div className="relative shrink-0 pr-2">
            <button
              type="button"
              disabled={deleting || blocking}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-full text-zinc-400 active:bg-zinc-800"
              aria-label="Post options"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-20 min-w-[10rem] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-lg">
                {isOwnPost && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void onDeletePost()}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-400 active:bg-zinc-800"
                  >
                    <Trash2 className="h-4 w-4" />
                    {deleting ? 'Deleting…' : 'Delete post'}
                  </button>
                )}
                {canBlockAuthor && (
                  <button
                    type="button"
                    disabled={blocking}
                    onClick={() => void onBlockAuthor()}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-400 active:bg-zinc-800"
                  >
                    <ShieldBan className="h-4 w-4" />
                    {blocking ? 'Blocking…' : 'Block user'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {post.mediaType === 'text' ? (
        <DoubleTapLikeLayer onLike={onDoubleTapLike}>
          <div className="px-4 py-3">
            <p className="allow-select whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-100">
              {post.caption}
            </p>
          </div>
        </DoubleTapLikeLayer>
      ) : (
        <DoubleTapLikeLayer
          onLike={onDoubleTapLike}
          onSingleTap={
            post.mediaType === 'video' ? onSingleTapMedia : undefined
          }
        >
          <AutoMedia ref={mediaRef} post={post} variant="feed" />
        </DoubleTapLikeLayer>
      )}
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
                  if (post.cid) {
                    noteSeeded(post.cid)
                    void hydrateSeed([post.cid])
                    setMsg('Reposted — auto-seeding this post')
                  } else {
                    setMsg('Reposted')
                  }
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
            onClick={() => setShareOpen(true)}
            className="flex min-h-11 min-w-11 touch-manipulation items-center gap-1.5 px-2 text-sm text-zinc-200 active:opacity-70"
            aria-label="Share post"
          >
            <Send className="h-6 w-6" />
          </button>
          {post.mediaType !== 'text' && post.cid && (
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
          )}
        </div>

        {post.mediaType !== 'text' && post.caption && (
          <p className="allow-select whitespace-pre-wrap text-sm text-zinc-200">
            {profile?.username && (
              <Link
                to={profilePath(post.pubkey)}
                className="mr-1.5 font-semibold text-zinc-100 active:opacity-80"
              >
                @{profile.username}
              </Link>
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

      <ShareSheet
        post={post}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onShared={(count) =>
          setMsg(count === 1 ? 'Sent to 1 person' : `Sent to ${count} people`)
        }
      />
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
            onChanged={onRefresh}
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
