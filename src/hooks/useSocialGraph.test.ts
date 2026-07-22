import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { Event } from 'nostr-tools'
import { useSocialGraph } from './useSocialGraph'
import { db } from '../lib/db'

const pubkey = 'a'.repeat(64)
const followA = 'b'.repeat(64)
const followB = 'c'.repeat(64)

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    fetchContactListEvents: vi.fn(),
  }
})

import { fetchContactListEvents } from '../lib/nostr'

describe('useSocialGraph', () => {
  beforeEach(async () => {
    vi.mocked(fetchContactListEvents).mockReset()
    await db.follows.clear()
    await db.seeds.clear()
  })

  it('loads and caches Kind 3 follows', async () => {
    const event = {
      kind: 3,
      created_at: 1_700_000_000,
      tags: [
        ['p', followA],
        ['p', followB],
      ],
      content: '',
      pubkey,
      id: '1'.repeat(64),
      sig: '2'.repeat(128),
    } as Event

    vi.mocked(fetchContactListEvents).mockResolvedValue([event])

    const { result } = renderHook(() => useSocialGraph(pubkey))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.following).toEqual([followA, followB])
    })

    const cached = await db.follows.get(pubkey)
    expect(cached?.following).toEqual([followA, followB])
  })

  it('returns empty list when pubkey is null', async () => {
    const { result } = renderHook(() => useSocialGraph(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.following).toEqual([])
    expect(fetchContactListEvents).not.toHaveBeenCalled()
  })

  it('surfaces relay errors', async () => {
    vi.mocked(fetchContactListEvents).mockRejectedValue(new Error('relay down'))

    const { result } = renderHook(() => useSocialGraph(pubkey))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toMatch(/relay down/)
    })
  })

  it('refresh re-fetches from relays', async () => {
    vi.mocked(fetchContactListEvents).mockResolvedValue([])

    const { result } = renderHook(() => useSocialGraph(pubkey))
    await waitFor(() => expect(result.current.loading).toBe(false))

    vi.mocked(fetchContactListEvents).mockResolvedValue([
      {
        kind: 3,
        created_at: 2,
        tags: [['p', followA]],
        content: '',
        pubkey,
        id: '3'.repeat(64),
        sig: '4'.repeat(128),
      } as Event,
    ])

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.following).toEqual([followA])
    expect(fetchContactListEvents).toHaveBeenCalledTimes(2)
  })
})
