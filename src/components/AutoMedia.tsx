import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useHelia } from '../context/HeliaContext'
import { useShouldAutoplay } from '../hooks/useInView'
import type { FeedPost } from '../lib/posts'
import { IPFS_GATEWAYS, cidToGatewayUrl } from '../lib/media'
import { loadCidAsObjectUrl } from '../lib/ipfs'

export interface AutoMediaHandle {
  togglePlayPause: () => void
}

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
 * Shows a gateway placeholder immediately, then upgrades to a local blob URL via
 * Helia P2P when available.
 */
export const AutoMedia = forwardRef<AutoMediaHandle, AutoMediaProps>(
  function AutoMedia(
    { post, variant = 'feed', root = null, className = '' },
    ref,
  ) {
    const { helia, ready } = useHelia()
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const gatewayIndexRef = useRef(0)
    const [containerRef, shouldPlay] = useShouldAutoplay<HTMLDivElement>({
      root,
      minRatio: variant === 'reel' ? 0.65 : 0.5,
    })
    const [src, setSrc] = useState(() =>
      post.cid ? cidToGatewayUrl(post.cid, IPFS_GATEWAYS[0]) : '',
    )
    const [localUrl, setLocalUrl] = useState<string | null>(null)
    const [muted, setMuted] = useState(true)
    const [playing, setPlaying] = useState(false)

    useImperativeHandle(ref, () => ({
      togglePlayPause: () => {
        const video = videoRef.current
        if (!video || post.mediaType === 'image') return
        if (video.paused) void video.play()
        else video.pause()
      },
    }))

    // Reset gateway placeholder when the post changes
    useEffect(() => {
      gatewayIndexRef.current = 0
      setLocalUrl(null)
      setSrc(
        post.cid ? cidToGatewayUrl(post.cid, IPFS_GATEWAYS[0]) : '',
      )
    }, [post.cid])

    // Upgrade to Helia blob URL in the background (never blocks initial render)
    useEffect(() => {
      if (!post.cid || !helia || !ready) return

      let revoked: string | null = null
      let cancelled = false

      void loadCidAsObjectUrl(helia, post.cid, {
        mimeType: post.mimeType,
        providerAddrs: post.providerAddrs ?? [],
        timeoutMs: 18_000,
      })
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url)
            return
          }
          revoked = url
          setLocalUrl(url)
          setSrc(url)
        })
        .catch(() => {
          // keep gateway placeholder; onError rotates gateways if needed
        })

      return () => {
        cancelled = true
        if (revoked) URL.revokeObjectURL(revoked)
      }
    }, [
      helia,
      ready,
      post.cid,
      post.mimeType,
      (post.providerAddrs ?? []).join('\0'),
    ])

    useEffect(() => {
      const video = videoRef.current
      if (!video || post.mediaType === 'image' || !src) return

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
      if (!post.cid) return
      if (localUrl && src === localUrl) {
        gatewayIndexRef.current = 0
        setLocalUrl(null)
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
      ? 'pointer-events-none h-full w-full object-cover'
      : 'pointer-events-none max-h-[70vh] w-full bg-black object-contain'

    if (!post.cid) {
      return (
        <div
          className={[
            'flex items-center justify-center bg-black text-xs text-zinc-500',
            isReel ? 'min-h-[50vh]' : 'min-h-[12rem]',
            className,
          ].join(' ')}
        >
          No media
        </div>
      )
    }

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
            draggable={false}
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
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setMuted((m) => !m)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={[
                'absolute z-10 touch-manipulation rounded-full bg-black/50 p-2.5 text-white active:bg-black/70',
                isReel ? 'bottom-28 left-3' : 'bottom-3 right-3',
              ].join(' ')}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
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
  },
)
