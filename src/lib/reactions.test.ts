import { describe, it, expect } from 'vitest'
import type { Event } from 'nostr-tools'
import { buildDeletionEvent, buildLikeEvent, buildRepostEvent } from './posts'

describe('like / repost toggle helpers', () => {
  const target = {
    id: '1'.repeat(64),
    pubkey: 'a'.repeat(64),
    kind: 1,
    created_at: 1,
    tags: [],
    content: 'ipfs://bafy',
    sig: '2'.repeat(128),
  } as Event

  it('builds a like and a deletion for that like', () => {
    const like = buildLikeEvent(target)
    expect(like.kind).toBe(7)
    const del = buildDeletionEvent(['abc'], 'unlike')
    expect(del.kind).toBe(5)
    expect(del.tags.some((t) => t[0] === 'e' && t[1] === 'abc')).toBe(true)
  })

  it('builds a repost and a deletion for unrepost', () => {
    const repost = buildRepostEvent(target)
    expect(repost.kind).toBe(6)
    const del = buildDeletionEvent(['repostid'], 'unrepost')
    expect(del.kind).toBe(5)
    expect(del.content).toBe('unrepost')
  })
})
