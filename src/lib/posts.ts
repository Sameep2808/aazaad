import type { Event, EventTemplate } from 'nostr-tools'
import {
  DEFAULT_RELAYS,
  getPool,
  publishEvent,
  type Filter,
} from './nostr'
import {
  cidToGatewayUrl,
  extractCid,
  isVideoFile,
  IPFS_GATEWAYS,
} from './media'

/** Kind 22 = short-form / vertical video (NIP-71). Kind 1 = text/image notes. */
export const FEED_KINDS = [1, 21, 22] as const

export interface FeedPost {
  id: string
  pubkey: string
  createdAt: number
  caption: string
  cid: string
  mediaType: 'image' | 'video' | 'unknown'
  mimeType: string | null
  gatewayUrl: string
  likes: number
  comments: number
  score: number
  raw: Event
  /** When set, this feed item is a Kind 6 repost of the original `raw` post */
  repost?: {
    id: string
    pubkey: string
    createdAt: number
  }
}

/** React list key — unique per original post OR per repost appearance */
export function feedItemKey(post: FeedPost): string {
  return post.repost ? `repost:${post.repost.id}` : post.id
}

export function buildMediaEventTemplate(opts: {
  file: File
  cid: string
  caption: string
}): EventTemplate {
  const { file, cid, caption } = opts
  const gateway = cidToGatewayUrl(cid)
  const ipfsUri = `ipfs://${cid}`
  const isVideo = isVideoFile(file)
  const mime = file.type || (isVideo ? 'video/mp4' : 'image/jpeg')

  const imeta = [
    'imeta',
    `url ${ipfsUri}`,
    `m ${mime}`,
    `alt ${caption || file.name}`,
  ]

  if (isVideo) {
    return {
      kind: 22,
      created_at: Math.floor(Date.now() / 1000),
      content: caption || ipfsUri,
      tags: [
        imeta,
        ['url', gateway],
        ['m', mime],
        ['title', caption || 'aazaad'],
        ['x', cid],
        ['t', 'aazaad'],
        ['client', 'aazaad'],
      ],
    }
  }

  // Images (and fallback) as Kind 1 with ipfs link + imeta
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    content: caption ? `${caption}\n\n${ipfsUri}` : ipfsUri,
    tags: [
      imeta,
      ['url', gateway],
      ['m', mime],
      ['x', cid],
      ['t', 'aazaad'],
      ['client', 'aazaad'],
    ],
  }
}

export function buildLikeEvent(target: Event): EventTemplate {
  return {
    kind: 7,
    created_at: Math.floor(Date.now() / 1000),
    content: '+',
    tags: [
      ['e', target.id],
      ['p', target.pubkey],
      ['k', String(target.kind)],
    ],
  }
}

/** NIP-18 Kind 6 repost — followers of the reposter can discover the original. */
export function buildRepostEvent(target: Event): EventTemplate {
  return {
    kind: 6,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify(target),
    tags: [
      ['e', target.id],
      ['p', target.pubkey],
      ['k', String(target.kind)],
      ['client', 'aazaad'],
    ],
  }
}

/** NIP-09 Kind 5 — delete one or more of your own events (unlike / unrepost). */
export function buildDeletionEvent(
  eventIds: string[],
  reason = 'undo',
): EventTemplate {
  return {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    content: reason,
    tags: [
      ...eventIds.map((id) => ['e', id] as [string, string]),
      ['client', 'aazaad'],
    ],
  }
}

export function buildCommentEvent(target: Event, text: string): EventTemplate {
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    content: text,
    tags: [
      ['e', target.id, '', 'root'],
      ['e', target.id, '', 'reply'],
      ['p', target.pubkey],
    ],
  }
}

function mediaTypeFromMime(mime: string | null, cidHint: string): FeedPost['mediaType'] {
  if (mime?.startsWith('video/')) return 'video'
  if (mime?.startsWith('image/')) return 'image'
  // Heuristic: short-form kinds are video
  void cidHint
  return 'unknown'
}

export function parseFeedPost(event: Event): FeedPost | null {
  let cid: string | null = extractCid(event.content)
  let mime: string | null = null

  for (const tag of event.tags) {
    if (tag[0] === 'x' && tag[1] && !cid) cid = tag[1]
    if (tag[0] === 'm' && tag[1]) mime = tag[1]
    if (tag[0] === 'imeta') {
      for (const part of tag.slice(1)) {
        if (part.startsWith('url ')) {
          const found = extractCid(part.slice(4))
          if (found) cid = found
        }
        if (part.startsWith('m ')) mime = part.slice(2)
      }
    }
    if (tag[0] === 'url' && tag[1] && !cid) cid = extractCid(tag[1])
  }

  if (!cid) return null

  if (event.kind === 21 || event.kind === 22) {
    mime = mime ?? 'video/mp4'
  }

  const mediaType =
    event.kind === 21 || event.kind === 22
      ? 'video'
      : mediaTypeFromMime(mime, cid)

  // Strip bare ipfs links from caption display
  const caption = event.content
    .replace(/ipfs:\/\/[a-zA-Z0-9]+/g, '')
    .replace(/https?:\/\/\S*\/ipfs\/[a-zA-Z0-9]+/g, '')
    .trim()

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    caption,
    cid,
    mediaType: mediaType === 'unknown' && mime?.startsWith('image/') ? 'image' : mediaType === 'unknown' ? 'video' : mediaType,
    mimeType: mime,
    gatewayUrl: cidToGatewayUrl(cid, IPFS_GATEWAYS[0]),
    likes: 0,
    comments: 0,
    score: 0,
    raw: event,
  }
}

/**
 * Score = (Likes * 2) + Comments / (Hours Since Published ^ 1.5)
 * Hours floored at 0.1 to avoid divide-by-zero for brand-new posts.
 */
export function scorePost(
  likes: number,
  comments: number,
  createdAtSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  const hours = Math.max((nowSec - createdAtSec) / 3600, 0.1)
  return likes * 2 + comments / hours ** 1.5
}

export function rankPosts(posts: FeedPost[], nowSec?: number): FeedPost[] {
  return [...posts]
    .map((p) => {
      const effectiveCreated = p.repost?.createdAt ?? p.createdAt
      return {
        ...p,
        score: scorePost(p.likes, p.comments, effectiveCreated, nowSec),
      }
    })
    .sort((a, b) => {
      const aTime = a.repost?.createdAt ?? a.createdAt
      const bTime = b.repost?.createdAt ?? b.createdAt
      return b.score - a.score || bTime - aTime
    })
}

export async function fetchRecentPostEvents(
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const pool = getPool()
  const relayList = [...relays]

  // Parallel queries so Kind-1 text notes don't crowd out media
  const [videos, tagged, shortForm] = await Promise.all([
    pool.querySync(relayList, { kinds: [21, 22], limit: 60 }, { maxWait }),
    pool.querySync(
      relayList,
      { kinds: [1], '#t': ['aazaad'], limit: 60 },
      { maxWait },
    ),
    // Broader short-form scrape as backup
    pool.querySync(relayList, { kinds: [22], limit: 40 }, { maxWait }),
  ])

  const byId = new Map<string, Event>()
  for (const event of [...videos, ...tagged, ...shortForm]) {
    byId.set(event.id, event)
  }

  return [...byId.values()].filter((e) => parseFeedPost(e) !== null)
}

/** Fetch media posts authored by a specific pubkey. */
export async function fetchAuthorMediaEvents(
  pubkey: string,
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  return fetchAuthorsMediaEvents([pubkey], relays, maxWait)
}

/**
 * Fetch media posts for many authors (following feed).
 * Authors are chunked so relays don't reject oversized filters.
 */
export async function fetchAuthorsMediaEvents(
  authors: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const unique = [...new Set(authors.filter(Boolean))]
  if (unique.length === 0) return []

  const pool = getPool()
  const relayList = [...relays]
  const chunkSize = 25
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize))
  }

  const batches = await Promise.all(
    chunks.map(async (chunk) => {
      const [videos, tagged] = await Promise.all([
        pool.querySync(
          relayList,
          { kinds: [21, 22], authors: chunk, limit: 80 },
          { maxWait },
        ),
        pool.querySync(
          relayList,
          { kinds: [1], authors: chunk, '#t': ['aazaad'], limit: 80 },
          { maxWait },
        ),
      ])
      return [...videos, ...tagged]
    }),
  )

  const byId = new Map<string, Event>()
  for (const event of batches.flat()) {
    byId.set(event.id, event)
  }
  return [...byId.values()].filter((e) => parseFeedPost(e) !== null)
}

/** Fetch Kind 6 reposts authored by these pubkeys. */
export async function fetchRepostEventsByAuthors(
  authors: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const unique = [...new Set(authors.filter(Boolean))]
  if (unique.length === 0) return []

  const pool = getPool()
  const relayList = [...relays]
  const chunkSize = 25
  const batches: Event[][] = []

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    batches.push(
      await pool.querySync(
        relayList,
        { kinds: [6], authors: chunk, limit: 80 },
        { maxWait },
      ),
    )
  }

  const byId = new Map<string, Event>()
  for (const event of batches.flat()) {
    if (event.kind === 6) byId.set(event.id, event)
  }
  return [...byId.values()]
}

export function parseRepostPointers(event: Event): {
  originalEventId: string
  originalPubkey: string
  embedded: Event | null
} | null {
  if (event.kind !== 6) return null
  const eTag = event.tags.find((t) => t[0] === 'e' && t[1])
  const pTag = event.tags.find((t) => t[0] === 'p' && t[1])
  if (!eTag?.[1]) return null

  let embedded: Event | null = null
  if (event.content?.startsWith('{')) {
    try {
      const parsed = JSON.parse(event.content) as Event
      if (parsed?.id && parsed?.pubkey) embedded = parsed
    } catch {
      embedded = null
    }
  }

  return {
    originalEventId: eTag[1],
    originalPubkey: pTag?.[1] ?? embedded?.pubkey ?? '',
    embedded,
  }
}

/** Fetch events by id (for resolving repost targets). */
export async function fetchEventsByIds(
  ids: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return []

  const pool = getPool()
  const relayList = [...relays]
  const chunkSize = 40
  const batches: Event[][] = []

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    batches.push(
      await pool.querySync(relayList, { ids: chunk, limit: chunk.length }, { maxWait }),
    )
  }

  const byId = new Map<string, Event>()
  for (const event of batches.flat()) {
    byId.set(event.id, event)
  }
  return [...byId.values()]
}

/**
 * Turn Kind 6 events into FeedPost items pointing at the original media.
 */
export async function hydrateRepostsToFeedPosts(
  repostEvents: Event[],
  relays: readonly string[] = DEFAULT_RELAYS,
): Promise<FeedPost[]> {
  const pointers = repostEvents
    .map((event) => {
      const ptr = parseRepostPointers(event)
      return ptr ? { event, ...ptr } : null
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  const embeddedById = new Map<string, Event>()
  const needFetch: string[] = []

  for (const ptr of pointers) {
    if (ptr.embedded && parseFeedPost(ptr.embedded)) {
      embeddedById.set(ptr.originalEventId, ptr.embedded)
    } else {
      needFetch.push(ptr.originalEventId)
    }
  }

  const fetched = await fetchEventsByIds(needFetch, relays)
  for (const event of fetched) {
    embeddedById.set(event.id, event)
  }

  const posts: FeedPost[] = []
  for (const ptr of pointers) {
    const original = embeddedById.get(ptr.originalEventId)
    if (!original) continue
    const parsed = parseFeedPost(original)
    if (!parsed) continue
    posts.push({
      ...parsed,
      repost: {
        id: ptr.event.id,
        pubkey: ptr.event.pubkey,
        createdAt: ptr.event.created_at,
      },
    })
  }
  return posts
}

export async function fetchLikesFor(
  eventIds: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 4000,
): Promise<Event[]> {
  if (eventIds.length === 0) return []
  const filter: Filter = {
    kinds: [7],
    '#e': eventIds.slice(0, 40),
    limit: 500,
  }
  return getPool().querySync([...relays], filter, { maxWait })
}

export async function fetchCommentsFor(
  eventIds: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 4000,
): Promise<Event[]> {
  if (eventIds.length === 0) return []
  const filter: Filter = {
    kinds: [1],
    '#e': eventIds.slice(0, 40),
    limit: 500,
  }
  return getPool().querySync([...relays], filter, { maxWait })
}

export function countByTarget(
  reactions: Event[],
  /** Only count kind-7 "+" style likes when kindFilter is 7 */
  kindFilter?: number,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const event of reactions) {
    if (kindFilter !== undefined && event.kind !== kindFilter) continue
    if (event.kind === 7 && event.content && event.content !== '+' && event.content !== '') {
      // treat empty/+ as like; skip other reactions optionally — still count +
      if (!['+', '❤️', '🤙', '💜'].includes(event.content)) continue
    }
    const eTag = event.tags.find((t) => t[0] === 'e')
    if (!eTag?.[1]) continue
    // Comments: skip if this event is itself a media root post
    if (event.kind === 1 && parseFeedPost(event)) continue
    counts.set(eTag[1], (counts.get(eTag[1]) ?? 0) + 1)
  }
  return counts
}

export { publishEvent, cidToGatewayUrl }
