import { describe, it, expect } from 'vitest'
import type { Event } from 'nostr-tools'
import {
  buildRepostEvent,
  feedItemKey,
  parseRepostPointers,
  parseFeedPost,
  type FeedPost,
} from './posts'

describe('reposts', () => {
  const original = {
    id: '1'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1_700_000_000,
    kind: 22,
    content: 'reel',
    tags: [
      ['imeta', 'url ipfs://bafycid', 'm video/mp4'],
      ['x', 'bafycid'],
    ],
    sig: '2'.repeat(128),
  } as Event

  it('builds a Kind 6 repost referencing the original', () => {
    const template = buildRepostEvent(original)
    expect(template.kind).toBe(6)
    expect(template.tags.some((t) => t[0] === 'e' && t[1] === original.id)).toBe(
      true,
    )
    expect(
      template.tags.some((t) => t[0] === 'p' && t[1] === original.pubkey),
    ).toBe(true)
    expect(JSON.parse(template.content).id).toBe(original.id)
  })

  it('parses repost pointers and embedded content', () => {
    const repost = {
      id: '3'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: 1_700_000_100,
      kind: 6,
      content: JSON.stringify(original),
      tags: [
        ['e', original.id],
        ['p', original.pubkey],
      ],
      sig: '4'.repeat(128),
    } as Event

    const ptr = parseRepostPointers(repost)
    expect(ptr?.originalEventId).toBe(original.id)
    expect(ptr?.embedded?.id).toBe(original.id)
    expect(parseFeedPost(ptr!.embedded!)?.cid).toBe('bafycid')
  })

  it('uses distinct feed keys for originals vs reposts', () => {
    const base: FeedPost = {
      id: original.id,
      pubkey: original.pubkey,
      createdAt: original.created_at,
      caption: 'reel',
      cid: 'bafycid',
      mediaType: 'video',
      mimeType: 'video/mp4',
      gatewayUrl: '',
      providerAddrs: [],
      likes: 0,
      comments: 0,
      score: 0,
      raw: original,
    }
    expect(feedItemKey(base)).toBe(original.id)
    expect(
      feedItemKey({
        ...base,
        repost: { id: 'r'.repeat(64), pubkey: 'b'.repeat(64), createdAt: 1 },
      }),
    ).toBe(`repost:${'r'.repeat(64)}`)
  })
})
