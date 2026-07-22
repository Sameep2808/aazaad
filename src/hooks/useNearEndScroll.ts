import { useEffect, useRef } from 'react'

/**
 * Fires `onNearEnd` when `root` scrolls near the bottom (or the sentinel enters view).
 */
export function useNearEndScroll(
  onNearEnd: () => void,
  opts?: {
    /** Distance from bottom (px) to trigger */
    offset?: number
    enabled?: boolean
    /** Optional explicit scroll root; defaults to nearest scroll parent / viewport */
    root?: Element | null
  },
) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const busy = useRef(false)
  const offset = opts?.offset ?? 480
  const enabled = opts?.enabled ?? true

  useEffect(() => {
    if (!enabled) return
    const node = sentinelRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting)
        if (!hit || busy.current) return
        busy.current = true
        try {
          onNearEnd()
        } finally {
          // Allow another trigger after a short cool-down (smooth paging)
          window.setTimeout(() => {
            busy.current = false
          }, 600)
        }
      },
      {
        root: opts?.root ?? null,
        rootMargin: `0px 0px ${offset}px 0px`,
        threshold: 0,
      },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [onNearEnd, enabled, offset, opts?.root])

  return sentinelRef
}
