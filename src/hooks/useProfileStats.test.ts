import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Event } from 'nostr-tools'
import { useProfileStats } from './useProfileStats'
import { db } from '../lib/db'

const me = 'a'.repeat(64)
const alice = 'b'.repeat(64)

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    fetchContactListEvents: vi.fn(),
    fetchFollowerCandidateEvents: vi.fn(),
    fetchUserPostEvents: vi.fn(),
  }
})

import {
  fetchContactListEvents,
  fetchFollowerCandidateEvents,
  fetchUserPostEvents,
} from '../lib/nostr'

describe('useProfileStats', () => {
  beforeEach(async () => {
    await db.profileStats.clear()
    await db.follows.clear()
    await db.accounts.clear()
    vi.mocked(fetchContactListEvents).mockReset()
    vi.mocked(fetchFollowerCandidateEvents).mockReset()
    vi.mocked(fetchUserPostEvents).mockReset()
  })

  it('loads posts, followers, and following counts', async () => {
    vi.mocked(fetchContactListEvents).mockResolvedValue([
      {
        kind: 3,
        created_at: 10,
        pubkey: me,
        tags: [['p', alice]],
        content: '',
        id: '1'.repeat(64),
        sig: '2'.repeat(128),
      } as Event,
    ])
    vi.mocked(fetchFollowerCandidateEvents).mockResolvedValue([
      {
        kind: 3,
        created_at: 11,
        pubkey: alice,
        tags: [['p', me]],
        content: '',
        id: '3'.repeat(64),
        sig: '4'.repeat(128),
      } as Event,
    ])
    vi.mocked(fetchUserPostEvents).mockResolvedValue([
      { id: '5'.repeat(64) } as Event,
      { id: '6'.repeat(64) } as Event,
    ])

    const { result } = renderHook(() => useProfileStats(me))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.followingCount).toBe(1)
      expect(result.current.followersCount).toBe(1)
      expect(result.current.postsCount).toBe(2)
    })
  })
})
