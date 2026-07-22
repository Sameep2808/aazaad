import { useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useHelia } from '../context/HeliaContext'
import { useShouldAutoplay } from '../hooks/useInView'
import type { FeedPost } from '../lib/posts'
import { IPFS_GATEWAYS, cidToGatewayUrl } from '../lib/media'
import { loadCidAsObjectUrl } from '../lib/ipfs'

export interface AutoMediaProps {
  post: FeedPost
  /** feed = bordered card media; reel = full-bleed cover */
  variant?: 'feed' | 'reel'
  /** Intersection root (e.g. reels scroll container) */
  root?: Element | null
  className?: string
}

/**
 * Image / video that autoplays only while in viewport focus and the tab is visible.
 * Videos start muted (browser policy); user can unmute.
 */
export function AutoMedia({
  post,
  variant = 'feed',
  root = null,
  className = '',
}: AutoMediaProps) {
  const { helia, ready } = useHelia()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const gatewayIndexRef = useRef(0)
  const [containerRef, shouldPlay] = useShouldAutoplay<HTMLDivElement>({
    root,
    minRatio: variant === 'reel' ? 0.65 : 0.5,
  })
  const [src, setSrc] = useState(() => cidToGatewayUrl(post.cid, IPFS_GATEWAYS[0]))
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false

    async function tryLocal() {
      if (!helia || !ready) return
      try {
        const url = await loadCidAsObjectUrl(helia, post.cid, post.mimeType)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        revoked = url
        setLocalUrl(url)
        setSrc(url)
      } catch {
        // gateway fallback
      }
    }

    void tryLocal()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [helia, ready, post.cid, post.mimeType])

  // Play / pause based on focus
  useEffect(() => {
    const video = videoRef.current
    if (!video || post.mediaType === 'image') return

    if (shouldPlay) {
      video.muted = muted
      const playPromise = video.play()
      if (playPromise !== undefined) {
        playPromise
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false))
      }
    } else {
      video.pause()
      setPlaying(false)
    }
  }, [shouldPlay, muted, post.mediaType, src])

  function onError() {
    if (localUrl && src === localUrl) {
      gatewayIndexRef.current = 0
      setSrc(cidToGatewayUrl(post.cid, IPFS_GATEWAYS[0]))
      return
    }
    const next = gatewayIndexRef.current + 1
    if (next < IPFS_GATEWAYS.length) {
      gatewayIndexRef.current = next
      setSrc(cidToGatewayUrl(post.cid, IPFS_GATEWAYS[next]))
    }
  }

  const isReel = variant === 'reel'
  const mediaClass = isReel
    ? 'h-full w-full object-cover'
    : 'max-h-[70vh] w-full bg-black object-contain'

  return (
    <div
      ref={containerRef}
      className={['relative overflow-hidden bg-black', className].join(' ')}
    >
      {post.mediaType === 'image' ? (
        <img
          src={src}
          alt={post.caption || 'Post'}
          className={mediaClass}
          onError={onError}
        />
      ) : (
        <>
          <video
            ref={videoRef}
            src={src}
            muted={muted}
            loop
            playsInline
            preload={shouldPlay ? 'auto' : 'metadata'}
            className={mediaClass}
            onError={onError}
            onClick={() => {
              const video = videoRef.current
              if (!video) return
              if (video.paused) void video.play()
              else video.pause()
            }}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setMuted((m) => !m)
            }}
            className={[
              'absolute rounded-full bg-black/50 p-2 text-white',
              isReel ? 'bottom-28 left-3' : 'bottom-3 right-3',
            ].join(' ')}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          {!playing && shouldPlay && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-white/80">
                Loading…
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
