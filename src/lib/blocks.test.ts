import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import { blockPeer } from './dm'
import {
  excludeBlockedPubkeys,
  filterOutBlockedAuthors,
  listBlockedPubkeys,
} from './blocks'

describe('blocks', () => {
  const alice = 'a'.repeat(64)
  const bob = 'b'.repeat(64)
  const carol = 'c'.repeat(64)

  beforeEach(async () => {
    await db.dmBlocks.clear()
  })

  it('lists blocked pubkeys for an owner', async () => {
    await blockPeer(alice, bob)
    await blockPeer(alice, carol)
    const list = await listBlockedPubkeys(alice)
    expect(list.sort()).toEqual([bob, carol].sort())
  })

  it('filters posts and reposts from blocked authors', () => {
    const blocked = new Set([bob])
    const posts = [
      { id: '1', pubkey: alice },
      { id: '2', pubkey: bob },
      {
        id: '3',
        pubkey: alice,
        repost: { pubkey: bob, id: 'r1', createdAt: 1 },
      },
      {
        id: '4',
        pubkey: carol,
        repost: { pubkey: alice, id: 'r2', createdAt: 1 },
      },
    ]
    const kept = filterOutBlockedAuthors(posts, blocked)
    expect(kept.map((p) => p.id)).toEqual(['1', '4'])
  })

  it('excludes blocked pubkeys from author lists', () => {
    const blocked = new Set([bob])
    expect(excludeBlockedPubkeys([alice, bob, carol], blocked)).toEqual([
      alice,
      carol,
    ])
  })
})
