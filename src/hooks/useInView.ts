import { useEffect, useRef, useState, type RefObject } from 'react'

export interface UseInViewOptions {
  /** 0–1 fraction of element that must be visible */
  threshold?: number | number[]
  root?: Element | null
  rootMargin?: string
  /** Require this much intersection ratio to count as "in focus" */
  minRatio?: number
}

/**
 * Tracks whether an element is sufficiently in the viewport (Intersection Observer).
 */
export function useInView<T extends Element>(
  options: UseInViewOptions = {},
): [RefObject<T>, boolean] {
  const {
    threshold = [0, 0.25, 0.5, 0.6, 0.75, 1],
    root = null,
    rootMargin = '0px',
    minRatio = 0.55,
  } = options

  const ref = useRef<T>(null!)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting && entry.intersectionRatio >= minRatio)
      },
      { threshold, root, rootMargin },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [threshold, root, rootMargin, minRatio])

  return [ref, inView]
}

/** True when the browser tab is visible (document.visibilityState). */
export function usePageFocus(): boolean {
  const [focused, setFocused] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  )

  useEffect(() => {
    const onVisibility = () => {
      setFocused(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return focused
}

/**
 * Combined: media should play only when the element is in view AND the page is visible.
 */
export function useShouldAutoplay<T extends Element>(
  options?: UseInViewOptions,
): [RefObject<T>, boolean] {
  const [ref, inView] = useInView<T>(options)
  const pageFocused = usePageFocus()
  return [ref, inView && pageFocused]
}
