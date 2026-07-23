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
  }
})

vi.mock('../lib/posts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/posts')>()
  return {
    ...actual,
    fetchAuthorMediaEvents: vi.fn(),
  }
})

vi.mock('../lib/profiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/profiles')>()
  return {
    ...actual,
    fetchAndCacheProfiles: vi.fn(async (pubkeys: string[]) => {
      const map = new Map()
      for (const pubkey of pubkeys) {
        map.set(pubkey, {
          pubkey,
          username: pubkey === alice ? 'alice' : null,
          displayName: pubkey === alice ? 'alice' : null,
          pictureUrl: null,
          pictureCid: null,
        })
      }
      return map
    }),
  }
})

import {
  fetchContactListEvents,
  fetchFollowerCandidateEvents,
} from '../lib/nostr'
import { fetchAuthorMediaEvents } from '../lib/posts'

describe('useProfileStats', () => {
  beforeEach(async () => {
    await db.profileStats.clear()
    await db.follows.clear()
    await db.accounts.clear()
    await db.posts.clear()
    vi.mocked(fetchContactListEvents).mockReset()
    vi.mocked(fetchFollowerCandidateEvents).mockReset()
    vi.mocked(fetchAuthorMediaEvents).mockReset()
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
    vi.mocked(fetchAuthorMediaEvents).mockResolvedValue([
      {
        id: '5'.repeat(64),
        kind: 22,
        pubkey: me,
        created_at: 12,
        content: 'a',
        tags: [['x', 'bafya'], ['imeta', 'url ipfs://bafya', 'm video/mp4']],
        sig: '7'.repeat(128),
      } as Event,
      {
        id: '6'.repeat(64),
        kind: 1,
        pubkey: me,
        created_at: 13,
        content: 'ipfs://bafyb',
        tags: [['x', 'bafyb'], ['t', 'aazaad'], ['m', 'image/jpeg']],
        sig: '8'.repeat(128),
      } as Event,
    ])

    const { result } = renderHook(() => useProfileStats(me))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.followingCount).toBe(1)
      expect(result.current.followersCount).toBe(1)
      expect(result.current.postsCount).toBe(2)
    })

    expect(result.current.following[0]?.username).toBe('alice')
    expect(result.current.followers[0]?.pubkey).toBe(alice)
  })
})
