import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Event } from 'nostr-tools'
import { discoverFollowersOfFollowing } from './exploreDiscovery'
import * as nostr from './nostr'

const me = '1'.repeat(64)
const followed = '2'.repeat(64)
const followerA = '3'.repeat(64)
const followerB = '4'.repeat(64)
const alreadyFollowing = '5'.repeat(64)

function kind3(author: string, tags: string[][], created_at = 100): Event {
  return {
    id: author.slice(0, 16) + String(created_at),
    pubkey: author,
    kind: 3,
    created_at,
    tags,
    content: '',
    sig: '0'.repeat(128),
  }
}

describe('discoverFollowersOfFollowing', () => {
  beforeEach(() => {
    vi.spyOn(nostr, 'fetchFollowerCandidateEvents').mockImplementation(
      async (seed) => {
        if (seed === followed) {
          return [
            kind3(followerA, [['p', followed]]),
            kind3(followerB, [['p', followed]]),
            kind3(alreadyFollowing, [['p', followed]]),
            kind3(me, [['p', followed]]),
          ]
        }
        return []
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns followers of follows, excluding self and already-followed', async () => {
    const found = await discoverFollowersOfFollowing(me, [
      followed,
      alreadyFollowing,
    ])
    expect(found.sort()).toEqual([followerA, followerB].sort())
    expect(found).not.toContain(me)
    expect(found).not.toContain(alreadyFollowing)
  })

  it('returns empty when not following anyone', async () => {
    expect(await discoverFollowersOfFollowing(me, [])).toEqual([])
  })
})
