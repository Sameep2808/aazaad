import { useEffect, useMemo, useRef, useState } from 'react'
import { Heart, MessageCircle, Radio } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useIPFSSeed } from '../hooks/useIPFSSeed'
import {
  useOptimisticEngagement,
  type EngageHandler,
} from '../hooks/useOptimisticEngagement'
import { useProfiles } from '../hooks/useProfiles'
import type { FeedPost } from '../lib/posts'
import type { ResolvedProfile } from '../lib/profiles'
import { AutoMedia } from './AutoMedia'
import { PostAuthorBar } from './UserAvatar'

interface ReelsProps {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onEngage?: EngageHandler
}

function ReelSlide({
  post,
  root,
  profile,
  onEngage,
}: {
  post: FeedPost
  root: Element | null
  profile?: ResolvedProfile | null
  onEngage?: EngageHandler
}) {
  const { seed, seeding } = useIPFSSeed()
  const { likes, comments, busy, error, like, comment } =
    useOptimisticEngagement(post, onEngage)
  const [showComment, setShowComment] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [seeded, setSeeded] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (error) setMsg(error)
  }, [error])

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

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-4 pb-20 pt-24">
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

      <div className="absolute bottom-24 right-3 z-10 flex flex-col items-center gap-5">
        <button
          type="button"
          onClick={() => void like()}
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
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment…"
            className="flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
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
            className="rounded-full bg-white px-4 text-xs font-semibold text-zinc-900"
          >
            Post
          </button>
        </div>
      )}
    </section>
  )
}

export function Reels({ posts, loading, error, onRefresh, onEngage }: ReelsProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [root, setRoot] = useState<Element | null>(null)
  const pubkeys = useMemo(() => posts.map((p) => p.pubkey), [posts])
  const { get: getProfile } = useProfiles(pubkeys)

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
            <ReelSlide
              post={post}
              root={root}
              profile={getProfile(post.pubkey)}
              onEngage={onEngage}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
