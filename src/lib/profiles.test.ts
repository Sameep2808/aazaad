import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from './db'
import {
  buildProfileMetadataEvent,
  clearMemoryProfiles,
  displayHandle,
  fetchAndCacheProfiles,
  getMemoryProfile,
  isProfileFresh,
  metadataToProfileRow,
  peekProfiles,
  PROFILE_CACHE_TTL_MS,
  profileRowToResolved,
  putMemoryProfile,
  saveProfileRow,
  type ResolvedProfile,
} from './profiles'
import { extractCid } from './media'

const querySync = vi.fn()

vi.mock('./nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nostr')>()
  return {
    ...actual,
    getPool: () => ({ querySync }),
    publishEvent: vi.fn().mockResolvedValue([]),
  }
})

function fakeProfile(pubkey: string, username: string): ResolvedProfile {
  return {
    pubkey,
    username,
    displayName: username,
    pictureUrl: `https://ipfs.io/ipfs/bafy${username}`,
    pictureCid: `bafy${username}`,
  }
}

describe('profiles', () => {
  beforeEach(async () => {
    clearMemoryProfiles()
    querySync.mockReset()
    await db.profiles.clear()
  })

  it('extracts picture CID and builds resolved profile', () => {
    const row = metadataToProfileRow('a'.repeat(64), {
      name: 'alice',
      display_name: 'Alice',
      picture: 'https://ipfs.io/ipfs/bafypic123',
    })
    expect(row.username).toBe('alice')
    expect(row.pictureCid).toBe('bafypic123')
    const resolved = profileRowToResolved(row)
    expect(resolved.pictureUrl).toContain('bafypic123')
    expect(displayHandle(resolved)).toBe('@alice')
  })

  it('builds Kind 0 metadata with picture gateway URL', () => {
    const event = buildProfileMetadataEvent({
      username: 'bob',
      pictureCid: 'bafyavatar',
    })
    expect(event.kind).toBe(0)
    const content = JSON.parse(event.content) as { name: string; picture: string }
    expect(content.name).toBe('bob')
    expect(extractCid(content.picture)).toBe('bafyavatar')
  })

  it('keeps profiles in memory across peeks', () => {
    const pk = 'a'.repeat(64)
    putMemoryProfile(fakeProfile(pk, 'alice'))
    expect(getMemoryProfile(pk)?.username).toBe('alice')
    expect(peekProfiles([pk]).get(pk)?.pictureCid).toBe('bafyalice')
    expect(isProfileFresh(pk)).toBe(true)
  })

  it('marks profiles stale after TTL', () => {
    const pk = 'b'.repeat(64)
    const old = Date.now() - PROFILE_CACHE_TTL_MS - 1
    putMemoryProfile(fakeProfile(pk, 'bob'), old)
    expect(isProfileFresh(pk)).toBe(false)
    expect(isProfileFresh(pk, PROFILE_CACHE_TTL_MS, old + 1000)).toBe(true)
  })

  it('skips relay fetch when memory profiles are fresh', async () => {
    const pk = 'c'.repeat(64)
    putMemoryProfile(fakeProfile(pk, 'carol'))
    const map = await fetchAndCacheProfiles([pk])
    expect(map.get(pk)?.username).toBe('carol')
    expect(querySync).not.toHaveBeenCalled()
  })

  it('seeds from IndexedDB without hitting relays when still fresh', async () => {
    const pk = 'd'.repeat(64)
    await saveProfileRow({
      pubkey: pk,
      username: 'dave',
      displayName: 'Dave',
      picture: 'https://ipfs.io/ipfs/bafydave',
      pictureCid: 'bafydave',
      updatedAt: Date.now(),
    })
    clearMemoryProfiles()
    const map = await fetchAndCacheProfiles([pk])
    expect(map.get(pk)?.username).toBe('dave')
    expect(getMemoryProfile(pk)?.pictureCid).toBe('bafydave')
    expect(querySync).not.toHaveBeenCalled()
  })

  it('fetches from relays when cache is stale', async () => {
    const pk = 'e'.repeat(64)
    putMemoryProfile(
      fakeProfile(pk, 'old'),
      Date.now() - PROFILE_CACHE_TTL_MS - 1000,
    )
    querySync.mockResolvedValue([
      {
        id: '1',
        pubkey: pk,
        kind: 0,
        created_at: 1,
        tags: [],
        content: JSON.stringify({
          name: 'erin',
          picture: 'https://ipfs.io/ipfs/bafyerin',
        }),
        sig: '',
      },
    ])
    const map = await fetchAndCacheProfiles([pk])
    expect(querySync).toHaveBeenCalled()
    expect(map.get(pk)?.username).toBe('erin')
    expect(isProfileFresh(pk)).toBe(true)
  })
})
