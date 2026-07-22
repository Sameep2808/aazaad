import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { useHelia } from '../context/HeliaContext'
import type { FeedPost } from '../lib/posts'
import { IPFS_GATEWAYS, cidToGatewayUrl } from '../lib/media'
import { loadCidAsObjectUrl } from '../lib/ipfs'
import { PostCard } from './Feed'

interface ProfilePostsGridProps {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

function GridThumb({
  post,
  selected,
  onSelect,
}: {
  post: FeedPost
  selected: boolean
  onSelect: () => void
}) {
  const { helia, ready } = useHelia()
  const [src, setSrc] = useState(() => cidToGatewayUrl(post.cid))

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false

    async function load() {
      if (helia && ready) {
        try {
          const url = await loadCidAsObjectUrl(helia, post.cid, post.mimeType)
          if (cancelled) {
            URL.revokeObjectURL(url)
            return
          }
          revoked = url
          setSrc(url)
          return
        } catch {
          // gateway fallback
        }
      }
      setSrc(cidToGatewayUrl(post.cid, IPFS_GATEWAYS[0]))
    }

    void load()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [helia, ready, post.cid, post.mimeType])

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'relative aspect-square overflow-hidden bg-zinc-900',
        selected ? 'ring-2 ring-white ring-inset' : '',
      ].join(' ')}
    >
      {post.mediaType === 'video' ? (
        <>
          <video
            src={src}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
            onError={() => setSrc(cidToGatewayUrl(post.cid, IPFS_GATEWAYS[1]))}
          />
          <span className="absolute right-1.5 top-1.5 rounded bg-black/60 p-0.5 text-white">
            <Play className="h-3 w-3 fill-white" />
          </span>
        </>
      ) : (
        <img
          src={src}
          alt={post.caption || 'Post'}
          className="h-full w-full object-cover"
          onError={() => setSrc(cidToGatewayUrl(post.cid, IPFS_GATEWAYS[1]))}
        />
      )}
    </button>
  )
}

export function ProfilePostsGrid({
  posts,
  loading,
  error,
  onRefresh,
}: ProfilePostsGridProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = posts.find((p) => p.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId && !posts.some((p) => p.id === selectedId)) {
      setSelectedId(null)
    }
  }, [posts, selectedId])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Posts</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-zinc-400 underline"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="text-xs text-amber-400">{error}</p>}

      {posts.length === 0 && !loading ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          No posts yet. Upload a photo or video to see it here.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-0.5">
          {posts.map((post) => (
            <GridThumb
              key={post.id}
              post={post}
              selected={post.id === selectedId}
              onSelect={() =>
                setSelectedId((id) => (id === post.id ? null : post.id))
              }
            />
          ))}
        </div>
      )}

      {selected && (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <PostCard post={selected} onChanged={onRefresh} />
        </div>
      )}
    </section>
  )
}
