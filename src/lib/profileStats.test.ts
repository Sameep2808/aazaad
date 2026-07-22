import { describe, it, expect } from 'vitest'
import type { Event } from 'nostr-tools'
import {
  deriveFollowersFromKind3,
  countUniquePosts,
  parseContactList,
} from './nostr'

describe('profile stats helpers', () => {
  const me = 'a'.repeat(64)
  const alice = 'b'.repeat(64)
  const bob = 'c'.repeat(64)

  it('derives followers from latest Kind 3 events', () => {
    const events = [
      {
        pubkey: alice,
        created_at: 1,
        tags: [['p', me]],
      },
      {
        pubkey: alice,
        created_at: 2,
        tags: [['p', bob]], // unfollowed me
      },
      {
        pubkey: bob,
        created_at: 3,
        tags: [
          ['p', me],
          ['p', alice],
        ],
      },
    ] as Event[]

    expect(deriveFollowersFromKind3(me, events)).toEqual([bob])
  })

  it('counts unique posts by event id', () => {
    const events = [
      { id: '1'.repeat(64) },
      { id: '1'.repeat(64) },
      { id: '2'.repeat(64) },
    ] as Event[]
    expect(countUniquePosts(events)).toBe(2)
  })

  it('parses following list', () => {
    const event = {
      tags: [
        ['p', alice],
        ['p', bob],
      ],
    } as Event
    expect(parseContactList(event)).toEqual([alice, bob])
  })
})
