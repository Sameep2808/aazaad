import { describe, it, expect, beforeEach } from 'vitest'
import type { Event } from 'nostr-tools'
import {
  cachePostFromEvent,
  loadCachedPosts,
  loadCachedPostsByAuthor,
  mergePosts,
} from './postCache'
import { db } from './db'
import type { FeedPost } from './posts'

function mediaEvent(overrides: Partial<Event> & Pick<Event, 'id' | 'pubkey'>): Event {
  return {
    kind: 22,
    created_at: 1_700_000_000,
    content: 'reel',
    tags: [
      ['imeta', 'url ipfs://bafycid', 'm video/mp4'],
      ['x', 'bafycid'],
      ['t', 'aazaad'],
    ],
    sig: '2'.repeat(128),
    ...overrides,
  } as Event
}

describe('post cache', () => {
  beforeEach(async () => {
    await db.posts.clear()
  })

  it('caches and loads media posts for home feed', async () => {
    const event = mediaEvent({ id: '1'.repeat(64), pubkey: 'a'.repeat(64) })
    const post = await cachePostFromEvent(event)
    expect(post?.cid).toBe('bafycid')

    const loaded = await loadCachedPosts()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(event.id)
  })

  it('filters cached posts by author for profile', async () => {
    const alice = 'a'.repeat(64)
    const bob = 'b'.repeat(64)
    await cachePostFromEvent(mediaEvent({ id: '1'.repeat(64), pubkey: alice }))
    await cachePostFromEvent(
      mediaEvent({ id: '2'.repeat(64), pubkey: bob, content: 'bob' }),
    )

    const alicePosts = await loadCachedPostsByAuthor(alice)
    expect(alicePosts).toHaveLength(1)
    expect(alicePosts[0].pubkey).toBe(alice)
  })

  it('merges local and remote posts by id', () => {
    const base = {
      caption: '',
      cid: 'bafy',
      mediaType: 'video' as const,
      mimeType: 'video/mp4',
      gatewayUrl: '',
      score: 0,
      raw: {} as Event,
      likes: 0,
      comments: 0,
    }
    const local: FeedPost[] = [
      { ...base, id: '1', pubkey: 'a', createdAt: 1, likes: 0 },
    ]
    const remote: FeedPost[] = [
      { ...base, id: '1', pubkey: 'a', createdAt: 1, likes: 5 },
      { ...base, id: '2', pubkey: 'b', createdAt: 2 },
    ]
    const merged = mergePosts(local, remote)
    expect(merged).toHaveLength(2)
    expect(merged.find((p) => p.id === '1')?.likes).toBe(5)
  })
})
