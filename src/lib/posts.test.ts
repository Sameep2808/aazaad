import { describe, it, expect } from 'vitest'
import type { Event } from 'nostr-tools'
import {
  buildMediaEventTemplate,
  buildTextEventTemplate,
  parseCommentEvent,
  parseFeedPost,
  scorePost,
  rankPosts,
  countByTarget,
  sortCommentsByLikes,
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

  it('builds and parses text-only Kind 1 notes', () => {
    const template = buildTextEventTemplate('  free speech forever  ')
    expect(template.kind).toBe(1)
    expect(template.content).toBe('free speech forever')
    expect(template.tags.some((t) => t[0] === 't' && t[1] === 'aazaad')).toBe(
      true,
    )

    const event = {
      id: '3'.repeat(64),
      pubkey: 'a'.repeat(64),
      created_at: 1_700_000_000,
      kind: 1,
      content: 'free speech forever',
      tags: [
        ['t', 'aazaad'],
        ['t', 'text'],
        ['client', 'aazaad'],
      ],
      sig: '2'.repeat(128),
    } as Event

    const post = parseFeedPost(event)
    expect(post?.mediaType).toBe('text')
    expect(post?.cid).toBe('')
    expect(post?.caption).toBe('free speech forever')
  })

  it('ignores reply notes without media as feed posts', () => {
    const event = {
      id: '4'.repeat(64),
      pubkey: 'a'.repeat(64),
      created_at: 1,
      kind: 1,
      content: 'a reply',
      tags: [
        ['e', '1'.repeat(64), '', 'reply'],
        ['t', 'aazaad'],
      ],
      sig: '2'.repeat(128),
    } as Event
    expect(parseFeedPost(event)).toBeNull()
  })

  it('parses comments on a post', () => {
    const postId = '1'.repeat(64)
    const event = {
      id: '5'.repeat(64),
      pubkey: 'c'.repeat(64),
      created_at: 100,
      kind: 1,
      content: 'nice shot',
      tags: [
        ['e', postId, '', 'root'],
        ['e', postId, '', 'reply'],
        ['p', 'a'.repeat(64)],
      ],
      sig: '2'.repeat(128),
    } as Event
    const comment = parseCommentEvent(event, postId)
    expect(comment?.content).toBe('nice shot')
    expect(comment?.pubkey).toBe('c'.repeat(64))
    expect(comment?.likes).toBe(0)
    expect(parseCommentEvent(event, '9'.repeat(64))).toBeNull()
  })

  it('sorts comments by likes then recency', () => {
    const base = {
      pubkey: 'a'.repeat(64),
      content: 'x',
      likedByMe: false,
      raw: {} as Event,
    }
    const sorted = sortCommentsByLikes([
      { ...base, id: '1', createdAt: 1, likes: 1 },
      { ...base, id: '2', createdAt: 3, likes: 5 },
      { ...base, id: '3', createdAt: 2, likes: 5 },
    ])
    expect(sorted.map((c) => c.id)).toEqual(['2', '3', '1'])
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
