import { useEffect, useMemo, useState } from 'react'
import { Heart, MessageCircle, Radio } from 'lucide-react'
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

interface FeedProps {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onEngage?: EngageHandler
  compact?: boolean
  emptyMessage?: string
}

export { AutoMedia as MediaPlayer } from './AutoMedia'

export function PostCard({
  post,
  profile,
  onEngage,
}: {
  post: FeedPost
  profile?: ResolvedProfile | null
  onChanged?: () => void
  onEngage?: EngageHandler
}) {
  const { seed, seeding } = useIPFSSeed()
  const { likes, comments, busy, error, like, comment } =
    useOptimisticEngagement(post, onEngage)
  const [commentText, setCommentText] = useState('')
  const [showComment, setShowComment] = useState(false)
  const [seeded, setSeeded] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (error) setMsg(error)
  }, [error])

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
      <PostAuthorBar profile={profile} pubkey={post.pubkey} variant="feed" />
      <AutoMedia post={post} variant="feed" />
      <div className="space-y-2 px-4 pt-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void like()}
            className="flex items-center gap-1.5 text-sm text-zinc-200"
          >
            <Heart className="h-5 w-5" />
            {likes}
          </button>
          <button
            type="button"
            onClick={() => setShowComment((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-zinc-200"
          >
            <MessageCircle className="h-5 w-5" />
            {comments}
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
          <p className="whitespace-pre-wrap text-sm text-zinc-200">
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
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none"
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
  onEngage,
  compact = false,
  emptyMessage = 'No posts from people you follow yet.',
}: FeedProps) {
  const pubkeys = useMemo(() => posts.map((p) => p.pubkey), [posts])
  const { get: getProfile } = useProfiles(pubkeys)

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
          <p className="text-xs text-zinc-600">
            Your posts and posts from accounts you follow show up here.
          </p>
        </div>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            profile={getProfile(post.pubkey)}
            onEngage={onEngage}
          />
        ))
      )}
    </div>
  )
}
