import { useCallback, useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { useHelia } from '../context/HeliaContext'
import { useProfiles } from '../hooks/useProfiles'
import { useNearEndScroll } from '../hooks/useNearEndScroll'
import { feedItemKey, type FeedPost } from '../lib/posts'
import { IPFS_GATEWAYS, cidToGatewayUrl } from '../lib/media'
import { loadCidAsObjectUrl } from '../lib/ipfs'
import { PostCard } from './Feed'
import type { EngageHandler } from '../hooks/useOptimisticEngagement'

interface ExplorePostsGridProps {
  posts: FeedPost[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onEngage?: EngageHandler
  emptyMessage?: string
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
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
      if (post.mediaType === 'text' || !post.cid) return
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
          // gateway
        }
      }
      setSrc(cidToGatewayUrl(post.cid, IPFS_GATEWAYS[0]))
    }

    void load()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [helia, ready, post.cid, post.mimeType, post.mediaType])

  if (post.mediaType === 'text') {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={[
          'relative flex aspect-square items-center justify-center overflow-hidden bg-zinc-900 p-2 text-left',
          selected ? 'ring-2 ring-white ring-inset' : '',
        ].join(' ')}
      >
        <p className="line-clamp-6 text-[10px] leading-snug text-zinc-200">
          {post.caption || 'Text'}
        </p>
      </button>
    )
  }

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

export function ExplorePostsGrid({
  posts,
  loading,
  error,
  onRefresh,
  onEngage,
  emptyMessage = 'No discovery posts yet. Follow more people to unlock Explore.',
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: ExplorePostsGridProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selected = posts.find((p) => feedItemKey(p) === selectedKey) ?? null
  const authorKeys = selected
    ? ([selected.pubkey, selected.repost?.pubkey].filter(Boolean) as string[])
    : []
  const { get: getProfile } = useProfiles(authorKeys)

  const handleNearEnd = useCallback(() => {
    if (hasMore && !loadingMore && onLoadMore) onLoadMore()
  }, [hasMore, loadingMore, onLoadMore])
  const sentinelRef = useNearEndScroll(handleNearEnd, {
    enabled: Boolean(onLoadMore) && hasMore,
  })

  useEffect(() => {
    if (selectedKey && !posts.some((p) => feedItemKey(p) === selectedKey)) {
      setSelectedKey(null)
    }
  }, [posts, selectedKey])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Discover</h2>
          <p className="text-[11px] text-zinc-500">
            Mutual follows first, then more people to discover
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-zinc-400 underline"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="px-1 text-xs text-amber-400">{error}</p>}

      {loading && posts.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">
          Loading explore posts…
        </p>
      ) : posts.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-500">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-3 gap-0.5">
          {posts.map((post) => {
            const key = feedItemKey(post)
            return (
              <GridThumb
                key={key}
                post={post}
                selected={key === selectedKey}
                onSelect={() =>
                  setSelectedKey((cur) => (cur === key ? null : key))
                }
              />
            )
          })}
        </div>
      )}

      {selected && (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <PostCard
            post={selected}
            profile={getProfile(selected.pubkey)}
            reposterProfile={
              selected.repost
                ? getProfile(selected.repost.pubkey)
                : undefined
            }
            onEngage={onEngage}
          />
        </div>
      )}

      <div ref={sentinelRef} className="h-6 w-full" aria-hidden />
      {loadingMore && (
        <p className="py-2 text-center text-xs text-zinc-500">Loading more…</p>
      )}
    </section>
  )
}
