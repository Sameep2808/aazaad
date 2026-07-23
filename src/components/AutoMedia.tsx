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
 * Videos start muted (browser policy); user can unmute.
 *
 * Media is loaded via Helia P2P (dialing publisher multiaddrs from the post)
 * with HTTP gateway as a secondary race — not as the primary src (gateways
 * never have browser-only content).
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
    const [src, setSrc] = useState<string | null>(null)
    const [localUrl, setLocalUrl] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(false)
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

    useEffect(() => {
      let revoked: string | null = null
      let cancelled = false

      async function loadMedia() {
        if (!post.cid) {
          setLoading(false)
          setLoadError(true)
          return
        }

        setLoading(true)
        setLoadError(false)
        setSrc(null)
        gatewayIndexRef.current = 0

        if (helia && ready) {
          try {
            const url = await loadCidAsObjectUrl(helia, post.cid, {
              mimeType: post.mimeType,
              providerAddrs: post.providerAddrs ?? [],
              timeoutMs: 45_000,
            })
            if (cancelled) {
              URL.revokeObjectURL(url)
              return
            }
            revoked = url
            setLocalUrl(url)
            setSrc(url)
            setLoading(false)
            setLoadError(false)
            return
          } catch {
            // fall through to gateway attempt
          }
        }

        if (cancelled) return
        // Last resort: public gateways (only works if CID was pinned publicly)
        setSrc(cidToGatewayUrl(post.cid, IPFS_GATEWAYS[0]))
        setLoading(false)
      }

      void loadMedia()
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
      if (!post.cid) {
        setLoadError(true)
        return
      }
      if (localUrl && src === localUrl) {
        gatewayIndexRef.current = 0
        setSrc(cidToGatewayUrl(post.cid, IPFS_GATEWAYS[0]))
        return
      }
      const next = gatewayIndexRef.current + 1
      if (next < IPFS_GATEWAYS.length) {
        gatewayIndexRef.current = next
        setSrc(cidToGatewayUrl(post.cid, IPFS_GATEWAYS[next]))
        return
      }
      setLoadError(true)
    }

    const isReel = variant === 'reel'
    const mediaClass = isReel
      ? 'pointer-events-none h-full w-full object-cover'
      : 'pointer-events-none max-h-[70vh] w-full bg-black object-contain'

    return (
      <div
        ref={containerRef}
        className={['relative overflow-hidden bg-black', className].join(' ')}
      >
        {loading && !src && (
          <div
            className={[
              'flex items-center justify-center text-xs text-zinc-400',
              isReel ? 'h-full min-h-[50vh]' : 'min-h-[12rem] py-16',
            ].join(' ')}
          >
            Loading media…
          </div>
        )}
        {loadError && !src && (
          <div
            className={[
              'flex items-center justify-center px-4 text-center text-xs text-zinc-500',
              isReel ? 'h-full min-h-[50vh]' : 'min-h-[12rem] py-16',
            ].join(' ')}
          >
            Media unavailable — keep the poster’s Aazaad tab open so it can seed.
          </div>
        )}
        {src && post.mediaType === 'image' ? (
          <img
            src={src}
            alt={post.caption || 'Post'}
            className={mediaClass}
            draggable={false}
            onError={onError}
            onLoad={() => setLoadError(false)}
          />
        ) : null}
        {src && post.mediaType !== 'image' ? (
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
        ) : null}
      </div>
    )
  },
)
