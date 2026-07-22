import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePageFocus } from './useInView'

describe('usePageFocus', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is true when document is visible', () => {
    const { result } = renderHook(() => usePageFocus())
    expect(result.current).toBe(true)
  })

  it('becomes false when document is hidden', () => {
    let state: DocumentVisibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    })

    const { result } = renderHook(() => usePageFocus())
    expect(result.current).toBe(true)

    act(() => {
      state = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current).toBe(false)
  })
})
