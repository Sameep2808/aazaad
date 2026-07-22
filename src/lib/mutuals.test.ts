import { describe, it, expect } from 'vitest'
import type { Event } from 'nostr-tools'
import { prioritizeMutualAuthors } from './mutuals'
import type { FeedPost } from './posts'

function post(id: string, pubkey: string, createdAt: number): FeedPost {
  return {
    id,
    pubkey,
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

const mutual = 'a'.repeat(64)
const other = 'b'.repeat(64)

describe('prioritizeMutualAuthors', () => {
  it('puts mutual authors before everyone else, newest within each group', () => {
    const ranked = prioritizeMutualAuthors(
      [
        post('o-old', other, 100),
        post('m-old', mutual, 150),
        post('o-new', other, 400),
        post('m-new', mutual, 300),
      ],
      [mutual],
    )
    expect(ranked.map((p) => p.id)).toEqual([
      'm-new',
      'm-old',
      'o-new',
      'o-old',
    ])
  })
})
