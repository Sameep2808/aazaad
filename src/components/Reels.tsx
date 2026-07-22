import { useEffect, useRef, useState } from 'react'
import { Heart, MessageCircle, Radio } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useIPFSSeed } from '../hooks/useIPFSSeed'
import {
  buildCommentEvent,
  buildLikeEvent,
  publishEvent,
  type FeedPost,
} from '../lib/posts'
import { AutoMedia } from './AutoMedia'

interface ReelsProps {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

function ReelSlide({
  post,
  root,
}: {
  post: FeedPost
  root: Element | null
}) {
  const { pubkey, signEvent } = useAuth()
  const { seed, seeding } = useIPFSSeed()
  const [likes, setLikes] = useState(post.likes)
  const [comments, setComments] = useState(post.comments)
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  const [seeded, setSeeded] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLikes(post.likes)
    setComments(post.comments)
  }, [post.id, post.likes, post.comments])

  async function onLike() {
    if (!pubkey) {
      setMsg('Log in to like')
      return
    }
    setBusy(true)
    try {
      const signed = await signEvent(buildLikeEvent(post.raw))
      await publishEvent(signed)
      setLikes((n) => n + 1)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Like failed')
    } finally {
      setBusy(false)
    }
  }

  async function onComment() {
    if (!pubkey) {
      setMsg('Log in to comment')
      return
    }
    if (!comment.trim()) return
    setBusy(true)
    try {
      const signed = await signEvent(buildCommentEvent(post.raw, comment.trim()))
      await publishEvent(signed)
      setComments((n) => n + 1)
      setComment('')
      setShowComment(false)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Comment failed')
    } finally {
      setBusy(false)
    }
  }

  async function onSeed() {
    try {
      await seed(post.cid)
      setSeeded(true)
      setMsg('Seeding')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Seed failed')
    }
  }

  return (
    <section className="relative h-full w-full bg-black">
      <AutoMedia
        post={post}
        variant="reel"
        root={root}
        className="absolute inset-0 h-full w-full"
      />

      {/* Gradient + caption */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-4 pb-20 pt-24">
        <p className="pointer-events-auto max-w-[75%] text-sm text-white drop-shadow">
          {post.caption || 'aazaad'}
        </p>
        <p className="mt-1 max-w-[75%] truncate font-mono text-[10px] text-white/50">
          {post.pubkey.slice(0, 12)}…
        </p>
        {msg && <p className="mt-1 text-xs text-white/70">{msg}</p>}
      </div>

      {/* Right-side actions */}
      <div className="absolute bottom-24 right-3 z-10 flex flex-col items-center gap-5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onLike()}
          className="flex flex-col items-center gap-1 text-white"
        >
          <span className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
            <Heart className="h-6 w-6" />
          </span>
          <span className="text-xs font-medium">{likes}</span>
        </button>

        <button
          type="button"
          onClick={() => setShowComment((v) => !v)}
          className="flex flex-col items-center gap-1 text-white"
        >
          <span className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
            <MessageCircle className="h-6 w-6" />
          </span>
          <span className="text-xs font-medium">{comments}</span>
        </button>

        <button
          type="button"
          disabled={seeding || seeded}
          onClick={() => void onSeed()}
          className="flex flex-col items-center gap-1 text-emerald-300 disabled:opacity-50"
        >
          <span className="rounded-full bg-black/35 p-3 backdrop-blur-sm">
            <Radio className="h-6 w-6" />
          </span>
          <span className="text-[10px] font-medium">
            {seeded ? 'Seeded' : 'Seed'}
          </span>
        </button>
      </div>

      {showComment && (
        <div className="absolute inset-x-0 bottom-16 z-20 flex gap-2 bg-black/80 px-3 py-2 backdrop-blur-md">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment…"
            className="flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void onComment()}
            className="rounded-full bg-white px-4 text-xs font-semibold text-zinc-900"
          >
            Post
          </button>
        </div>
      )}
    </section>
  )
}

export function Reels({ posts, loading, error, onRefresh }: ReelsProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [root, setRoot] = useState<Element | null>(null)

  useEffect(() => {
    setRoot(scrollerRef.current)
  }, [])

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
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-900"
        >
          Upload
        </Link>
        {error && <p className="text-xs text-amber-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-black">
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-3">
        <h1 className="text-sm font-semibold text-white drop-shadow">Reels</h1>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-white/70 underline"
        >
          Refresh
        </button>
      </div>
      {error && (
        <p className="absolute inset-x-0 top-10 z-20 px-4 text-center text-[11px] text-amber-300">
          {error}
        </p>
      )}

      <div
        ref={scrollerRef}
        className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain"
        style={{
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {posts.map((post) => (
          <div key={post.id} className="h-full w-full snap-start snap-always">
            <ReelSlide post={post} root={root} />
          </div>
        ))}
      </div>
    </div>
  )
}
