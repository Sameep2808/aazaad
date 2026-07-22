import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDoubleTap } from './useDoubleTap'

describe('useDoubleTap', () => {
  it('fires onDoubleTap on two quick taps and skips single', () => {
    vi.useFakeTimers()
    const onDouble = vi.fn()
    const onSingle = vi.fn()
    const { result } = renderHook(() => useDoubleTap(onDouble, onSingle, 280))

    act(() => {
      result.current.onPointerDown({
        clientX: 10,
        clientY: 10,
      } as React.PointerEvent)
      result.current.onPointerUp()
    })
    act(() => {
      result.current.onPointerDown({
        clientX: 10,
        clientY: 10,
      } as React.PointerEvent)
      result.current.onPointerUp()
    })

    expect(onDouble).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onSingle).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('fires onSingleTap after delay when only one tap', () => {
    vi.useFakeTimers()
    const onDouble = vi.fn()
    const onSingle = vi.fn()
    const { result } = renderHook(() => useDoubleTap(onDouble, onSingle, 280))

    act(() => {
      result.current.onPointerDown({
        clientX: 10,
        clientY: 10,
      } as React.PointerEvent)
      result.current.onPointerUp()
    })
    expect(onSingle).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(280)
    })
    expect(onSingle).toHaveBeenCalledTimes(1)
    expect(onDouble).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
