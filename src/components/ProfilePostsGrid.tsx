import { useEffect, useState } from 'react'
import { Grid3X3, Play, Repeat2 } from 'lucide-react'
import { useHelia } from '../context/HeliaContext'
import { useProfiles } from '../hooks/useProfiles'
import { feedItemKey, type FeedPost } from '../lib/posts'
import { IPFS_GATEWAYS, cidToGatewayUrl } from '../lib/media'
import { loadCidAsObjectUrl } from '../lib/ipfs'
import { PostCard } from './Feed'

type ProfileTab = 'posts' | 'reposts'

interface ProfilePostsGridProps {
  posts: FeedPost[]
  reposts: FeedPost[]
  loading: boolean
  repostsLoading: boolean
  error: string | null
  repostsError: string | null
  onRefreshPosts: () => void
  onRefreshReposts: () => void
}

function GridThumb({
  post,
  selected,
  onSelect,
  showRepostBadge,
}: {
  post: FeedPost
  selected: boolean
  onSelect: () => void
  showRepostBadge?: boolean
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
        {showRepostBadge && (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/60 p-0.5 text-white">
            <Repeat2 className="h-3 w-3" />
          </span>
        )}
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
      {showRepostBadge && (
        <span className="absolute left-1.5 top-1.5 rounded bg-black/60 p-0.5 text-white">
          <Repeat2 className="h-3 w-3" />
        </span>
      )}
    </button>
  )
}

export function ProfilePostsGrid({
  posts,
  reposts,
  loading,
  repostsLoading,
  error,
  repostsError,
  onRefreshPosts,
  onRefreshReposts,
}: ProfilePostsGridProps) {
  const [tab, setTab] = useState<ProfileTab>('posts')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const items = tab === 'posts' ? posts : reposts
  const isLoading = tab === 'posts' ? loading : repostsLoading
  const tabError = tab === 'posts' ? error : repostsError
  const selected = items.find((p) => feedItemKey(p) === selectedKey) ?? null

  const authorKeys = selected
    ? [selected.pubkey, selected.repost?.pubkey].filter(Boolean) as string[]
    : []
  const { get: getProfile } = useProfiles(authorKeys)

  useEffect(() => {
    setSelectedKey(null)
  }, [tab])

  useEffect(() => {
    if (selectedKey && !items.some((p) => feedItemKey(p) === selectedKey)) {
      setSelectedKey(null)
    }
  }, [items, selectedKey])

  return (
    <section className="space-y-3">
      <div className="flex border-b border-zinc-800">
        <button
          type="button"
          onClick={() => setTab('posts')}
          className={[
            'flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold uppercase tracking-wide',
            tab === 'posts'
              ? 'border-b-2 border-white text-white'
              : 'text-zinc-500',
          ].join(' ')}
        >
          <Grid3X3 className="h-4 w-4" />
          Posts
        </button>
        <button
          type="button"
          onClick={() => setTab('reposts')}
          className={[
            'flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold uppercase tracking-wide',
            tab === 'reposts'
              ? 'border-b-2 border-white text-white'
              : 'text-zinc-500',
          ].join(' ')}
        >
          <Repeat2 className="h-4 w-4" />
          Reposts
        </button>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() =>
            tab === 'posts' ? onRefreshPosts() : onRefreshReposts()
          }
          className="text-xs text-zinc-400 underline"
        >
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {tabError && <p className="text-xs text-amber-400">{tabError}</p>}

      {items.length === 0 && !isLoading ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          {tab === 'posts'
            ? 'No posts yet. Upload a photo or video to see it here.'
            : 'No reposts yet. Repost something from Home or Reels.'}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-0.5">
          {items.map((post) => {
            const key = feedItemKey(post)
            return (
              <GridThumb
                key={key}
                post={post}
                selected={key === selectedKey}
                showRepostBadge={tab === 'reposts'}
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
            onChanged={() =>
              tab === 'posts' ? onRefreshPosts() : onRefreshReposts()
            }
          />
        </div>
      )}
    </section>
  )
}
