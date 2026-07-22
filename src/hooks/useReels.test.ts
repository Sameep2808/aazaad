import { describe, it, expect } from 'vitest'
import type { Event } from 'nostr-tools'
import { sortReelsLatest } from '../hooks/useReels'
import type { FeedPost } from '../lib/posts'

function post(id: string, createdAt: number): FeedPost {
  return {
    id,
    pubkey: 'a'.repeat(64),
    createdAt,
    caption: id,
    cid: 'bafy' + id,
    mediaType: 'video',
    mimeType: 'video/mp4',
    gatewayUrl: '',
    likes: 0,
    comments: 0,
    score: 0,
    raw: {} as Event,
  }
}

describe('sortReelsLatest', () => {
  it('orders posts newest first', () => {
    const ranked = sortReelsLatest([
      post('old', 100),
      post('new', 300),
      post('mid', 200),
    ])
    expect(ranked.map((p) => p.id)).toEqual(['new', 'mid', 'old'])
  })
})
