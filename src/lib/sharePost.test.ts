import { describe, it, expect } from 'vitest'
import { formatSharedPostDm, postPath } from './sharePost'
import type { FeedPost } from './posts'

function fakePost(partial: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    createdAt: 1,
    caption: 'Hello from aazaad',
    cid: '',
    mediaType: 'text',
    mimeType: 'text/plain',
    gatewayUrl: '',
      providerAddrs: [],
    likes: 0,
    comments: 0,
    score: 0,
    raw: {} as FeedPost['raw'],
    ...partial,
  }
}

describe('sharePost', () => {
  it('builds post path', () => {
    expect(postPath('Ab'.repeat(32))).toBe(`/p/${'ab'.repeat(32)}`)
  })

  it('formats a shared DM with optional note', () => {
    const text = formatSharedPostDm(
      fakePost(),
      {
        pubkey: 'b'.repeat(64),
        username: 'alice',
        displayName: 'Alice',
        pictureUrl: null,
        pictureCid: null,
      },
      'Check this out',
    )
    expect(text).toContain('Check this out')
    expect(text).toContain('Shared a post on aazaad')
    expect(text).toContain('@alice')
    expect(text).toContain(`/p/${'a'.repeat(64)}`)
    expect(text).toContain('/u/')
  })
})
