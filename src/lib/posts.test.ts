import { describe, it, expect } from 'vitest'
import type { Event } from 'nostr-tools'
import {
  buildMediaEventTemplate,
  parseFeedPost,
  scorePost,
  rankPosts,
  countByTarget,
  type FeedPost,
} from './posts'

describe('posts / feed algorithm', () => {
  it('builds video Kind 22 and image Kind 1 templates with CID', () => {
    const video = new File(['v'], 'clip.mp4', { type: 'video/mp4' })
    const image = new File(['i'], 'pic.jpg', { type: 'image/jpeg' })

    const vEvent = buildMediaEventTemplate({
      file: video,
      cid: 'bafyvideo',
      caption: 'hello reel',
    })
    expect(vEvent.kind).toBe(22)
    expect(vEvent.content).toContain('hello reel')
    expect(vEvent.tags.some((t) => t[0] === 'x' && t[1] === 'bafyvideo')).toBe(true)

    const iEvent = buildMediaEventTemplate({
      file: image,
      cid: 'bafyimage',
      caption: 'hello pic',
    })
    expect(iEvent.kind).toBe(1)
    expect(iEvent.content).toContain('ipfs://bafyimage')
  })

  it('parses feed posts from events', () => {
    const event = {
      id: '1'.repeat(64),
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_000,
      kind: 22,
      content: 'my reel',
      tags: [
        ['imeta', 'url ipfs://bafycid123', 'm video/mp4'],
        ['x', 'bafycid123'],
      ],
      sig: '2'.repeat(128),
    } as Event

    const post = parseFeedPost(event)
    expect(post?.cid).toBe('bafycid123')
    expect(post?.mediaType).toBe('video')
    expect(post?.caption).toBe('my reel')
  })

  it('scores posts with likes*2 + comments / hours^1.5', () => {
    const now = 1_700_003_600 // 1 hour after created
    const created = 1_700_000_000
    // likes=3 => 6; comments=4; hours=1 => 4/1 = 4; total 10
    expect(scorePost(3, 4, created, now)).toBeCloseTo(10, 5)
  })

  it('ranks higher engagement above older low engagement', () => {
    const base = {
      pubkey: 'a'.repeat(64),
      caption: '',
      cid: 'bafy',
      mediaType: 'video' as const,
      mimeType: 'video/mp4',
      gatewayUrl: '',
      score: 0,
      raw: {} as Event,
    }
    const posts: FeedPost[] = [
      { ...base, id: 'old', createdAt: 100, likes: 0, comments: 0 },
      { ...base, id: 'hot', createdAt: 100, likes: 10, comments: 5 },
    ]
    const ranked = rankPosts(posts, 100 + 3600)
    expect(ranked[0].id).toBe('hot')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('counts likes by e-tag', () => {
    const target = '1'.repeat(64)
    const likes = [
      {
        kind: 7,
        content: '+',
        tags: [['e', target]],
      },
      {
        kind: 7,
        content: '+',
        tags: [['e', target]],
      },
    ] as Event[]
    expect(countByTarget(likes, 7).get(target)).toBe(2)
  })
})
