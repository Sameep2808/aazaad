import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

const DEFAULT_DELAY = 280

/**
 * Distinguish single vs double tap without blocking scroll.
 * Uses pointerup so touch scrolling isn't interrupted by preventDefault.
 */
export function useDoubleTap(
  onDoubleTap: () => void,
  onSingleTap?: () => void,
  delayMs = DEFAULT_DELAY,
) {
  const lastTap = useRef(0)
  const singleTimer = useRef<number | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const moved = useRef(false)

  const clearSingle = useCallback(() => {
    if (singleTimer.current != null) {
      window.clearTimeout(singleTimer.current)
      singleTimer.current = null
    }
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    moved.current = false
    startX.current = e.clientX
    startY.current = e.clientY
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const dx = Math.abs(e.clientX - startX.current)
      const dy = Math.abs(e.clientY - startY.current)
      if (dx + dy > 12) {
        moved.current = true
        clearSingle()
      }
    },
    [clearSingle],
  )

  const onPointerUp = useCallback(() => {
    if (moved.current) return

    const now = Date.now()
    if (now - lastTap.current < delayMs) {
      clearSingle()
      lastTap.current = 0
      onDoubleTap()
      return
    }

    lastTap.current = now
    if (!onSingleTap) return
    clearSingle()
    singleTimer.current = window.setTimeout(() => {
      singleTimer.current = null
      onSingleTap()
    }, delayMs)
  }, [clearSingle, delayMs, onDoubleTap, onSingleTap])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
