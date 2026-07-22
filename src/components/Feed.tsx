import { useEffect, useState } from 'react'
import { Heart, MessageCircle, Radio } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useIPFSSeed } from '../hooks/useIPFSSeed'
import {
  buildCommentEvent,
  buildLikeEvent,
  publishEvent,
  type FeedPost,
} from '../lib/posts'
import { AutoMedia } from './AutoMedia'

interface FeedProps {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  /** Compact header for embedding under profile */
  compact?: boolean
  emptyMessage?: string
}

/** @deprecated Prefer AutoMedia — kept for any external imports */
export { AutoMedia as MediaPlayer } from './AutoMedia'

export function PostCard({
  post,
  onChanged,
}: {
  post: FeedPost
  onChanged: () => void
}) {
  const { pubkey, signEvent } = useAuth()
  const { seed, seeding } = useIPFSSeed()
  const [comment, setComment] = useState('')
  const [showComment, setShowComment] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localLikes, setLocalLikes] = useState(post.likes)
  const [localComments, setLocalComments] = useState(post.comments)
  const [seeded, setSeeded] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setLocalLikes(post.likes)
    setLocalComments(post.comments)
  }, [post.id, post.likes, post.comments])

  async function onLike() {
    if (!pubkey) {
      setMsg('Log in to like')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const signed = await signEvent(buildLikeEvent(post.raw))
      await publishEvent(signed)
      setLocalLikes((n) => n + 1)
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
    setMsg(null)
    try {
      const signed = await signEvent(buildCommentEvent(post.raw, comment.trim()))
      await publishEvent(signed)
      setLocalComments((n) => n + 1)
      setComment('')
      setShowComment(false)
      onChanged()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Comment failed')
    } finally {
      setBusy(false)
    }
  }

  async function onSeed() {
    setMsg(null)
    try {
      await seed(post.cid)
      setSeeded(true)
      setMsg('Seeding to the network from this device')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Seed failed')
    }
  }

  return (
    <article className="border-b border-zinc-800 pb-4">
      <div className="px-4 py-2">
        <p className="truncate font-mono text-[10px] text-zinc-500">{post.pubkey}</p>
      </div>
      <AutoMedia post={post} variant="feed" />
      <div className="space-y-2 px-4 pt-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onLike()}
            className="flex items-center gap-1.5 text-sm text-zinc-200"
          >
            <Heart className="h-5 w-5" />
            {localLikes}
          </button>
          <button
            type="button"
            onClick={() => setShowComment((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-zinc-200"
          >
            <MessageCircle className="h-5 w-5" />
            {localComments}
          </button>
          <button
            type="button"
            disabled={seeding || seeded}
            onClick={() => void onSeed()}
            className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-700/60 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-300 disabled:opacity-50"
          >
            <Radio className="h-3.5 w-3.5" />
            {seeded ? 'Seeding' : seeding ? 'Starting…' : 'Seed to Network'}
          </button>
        </div>

        {post.caption && (
          <p className="whitespace-pre-wrap text-sm text-zinc-200">{post.caption}</p>
        )}

        {showComment && (
          <div className="flex gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment…"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void onComment()}
              className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-zinc-900"
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
  compact = false,
  emptyMessage = 'No media posts on relays yet.',
}: FeedProps) {
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
            className="text-xs text-zinc-400 underline"
          >
            Refresh
          </button>
        </div>
      )}
      {error && <p className="px-4 text-sm text-amber-400">{error}</p>}
      {posts.length === 0 && !loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <p className="text-sm text-zinc-400">{emptyMessage}</p>
          <p className="text-xs text-zinc-600">Upload a photo or reel to see it here.</p>
        </div>
      ) : (
        posts.map((post) => (
          <PostCard key={post.id} post={post} onChanged={onRefresh} />
        ))
      )}
    </div>
  )
}
