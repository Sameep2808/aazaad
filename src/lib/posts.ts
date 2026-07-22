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
import {
  AUTHOR_CHUNK_SIZE,
  ENGAGEMENT_EVENT_LIMIT,
  ENGAGEMENT_ID_CHUNK,
  FEED_PAGE_SIZE,
  nextUntilCursor,
  querySyncThrottled,
} from './relayThrottle'

/** Kind 22 = short-form / vertical video (NIP-71). Kind 1 = text/image notes. */
export const FEED_KINDS = [1, 21, 22] as const

export interface FeedPageResult {
  events: Event[]
  /** Pass as `until` for the next older page; null when exhausted */
  nextUntil: number | null
  exhausted: boolean
}
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

export async function fetchRecentPostEventsPage(opts?: {
  until?: number
  limit?: number
  relays?: readonly string[]
  maxWait?: number
}): Promise<FeedPageResult> {
  const limit = opts?.limit ?? FEED_PAGE_SIZE
  const relays = opts?.relays ?? DEFAULT_RELAYS
  const maxWait = opts?.maxWait ?? 3200
  const until = opts?.until
  const relayList = [...relays]

  const base: Filter = { limit, ...(until != null ? { until } : {}) }

  // Sequential queries share the rate budget — avoids 160-event bursts
  const videos = await querySyncThrottled(
    relayList,
    { ...base, kinds: [21, 22] },
    { maxWait },
  )
  const tagged = await querySyncThrottled(
    relayList,
    { ...base, kinds: [1], '#t': ['aazaad'] },
    { maxWait },
  )

  const byId = new Map<string, Event>()
  for (const event of [...videos, ...tagged]) {
    byId.set(event.id, event)
  }
  const events = [...byId.values()].filter((e) => parseFeedPost(e) !== null)
  const nextUntil = nextUntilCursor(events)
  // Exhausted when we got fewer media items than a half page
  const exhausted = events.length < Math.max(3, Math.floor(limit / 2))
  return { events, nextUntil: exhausted ? null : nextUntil, exhausted }
}

/** @deprecated Prefer fetchRecentPostEventsPage — kept for callers needing one shot. */
export async function fetchRecentPostEvents(
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const page = await fetchRecentPostEventsPage({
    relays,
    maxWait,
    limit: FEED_PAGE_SIZE,
  })
  return page.events
}

/** Fetch media posts authored by a specific pubkey. */
export async function fetchAuthorMediaEvents(
  pubkey: string,
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const page = await fetchAuthorsMediaEventsPage({
    authors: [pubkey],
    relays,
    maxWait,
    limit: FEED_PAGE_SIZE,
  })
  return page.events
}

/**
 * One page of media for a set of authors (rate-limited + chunked).
 */
export async function fetchAuthorsMediaEventsPage(opts: {
  authors: string[]
  until?: number
  limit?: number
  /** Which author chunk to fetch (0-based). */
  authorChunkIndex?: number
  relays?: readonly string[]
  maxWait?: number
}): Promise<FeedPageResult & { nextAuthorChunk: number | null; authorChunks: number }> {
  const unique = [...new Set(opts.authors.filter(Boolean))]
  const limit = opts.limit ?? FEED_PAGE_SIZE
  const relays = opts.relays ?? DEFAULT_RELAYS
  const maxWait = opts.maxWait ?? 3200
  const until = opts.until
  const chunkIndex = opts.authorChunkIndex ?? 0
  const relayList = [...relays]

  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += AUTHOR_CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + AUTHOR_CHUNK_SIZE))
  }
  if (chunks.length === 0) {
    return {
      events: [],
      nextUntil: null,
      exhausted: true,
      nextAuthorChunk: null,
      authorChunks: 0,
    }
  }

  const chunk = chunks[Math.min(chunkIndex, chunks.length - 1)]!
  const base: Filter = {
    authors: chunk,
    limit,
    ...(until != null ? { until } : {}),
  }

  const videos = await querySyncThrottled(
    relayList,
    { ...base, kinds: [21, 22] },
    { maxWait },
  )
  const tagged = await querySyncThrottled(
    relayList,
    { ...base, kinds: [1], '#t': ['aazaad'] },
    { maxWait },
  )

  const byId = new Map<string, Event>()
  for (const event of [...videos, ...tagged]) byId.set(event.id, event)
  const events = [...byId.values()].filter((e) => parseFeedPost(e) !== null)

  const hasMoreAuthorChunks = chunkIndex + 1 < chunks.length
  const nextUntil = nextUntilCursor(events)
  const thinPage = events.length < Math.max(2, Math.floor(limit / 3))

  // Prefer walking author chunks on first until-window; then go older
  let nextAuthorChunk: number | null = null
  let exhausted = false
  if (hasMoreAuthorChunks) {
    nextAuthorChunk = chunkIndex + 1
  } else if (!thinPage && nextUntil != null) {
    nextAuthorChunk = 0
  } else {
    exhausted = true
  }

  return {
    events,
    nextUntil: hasMoreAuthorChunks ? until ?? null : nextUntil,
    exhausted,
    nextAuthorChunk: exhausted ? null : nextAuthorChunk,
    authorChunks: chunks.length,
  }
}

/**
 * Fetch media posts for many authors (following feed).
 * Uses paginated first-page helper for a bounded, rate-safe initial load.
 */
export async function fetchAuthorsMediaEvents(
  authors: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const page = await fetchAuthorsMediaEventsPage({
    authors,
    relays,
    maxWait,
    limit: FEED_PAGE_SIZE,
    authorChunkIndex: 0,
  })
  return page.events
}

/** Fetch Kind 6 reposts authored by these pubkeys (one throttled page). */
export async function fetchRepostEventsByAuthorsPage(opts: {
  authors: string[]
  until?: number
  limit?: number
  authorChunkIndex?: number
  relays?: readonly string[]
  maxWait?: number
}): Promise<FeedPageResult & { nextAuthorChunk: number | null }> {
  const unique = [...new Set(opts.authors.filter(Boolean))]
  const limit = opts.limit ?? FEED_PAGE_SIZE
  const relays = opts.relays ?? DEFAULT_RELAYS
  const maxWait = opts.maxWait ?? 3200
  const until = opts.until
  const chunkIndex = opts.authorChunkIndex ?? 0

  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += AUTHOR_CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + AUTHOR_CHUNK_SIZE))
  }
  if (chunks.length === 0) {
    return { events: [], nextUntil: null, exhausted: true, nextAuthorChunk: null }
  }

  const chunk = chunks[Math.min(chunkIndex, chunks.length - 1)]!
  const events = (
    await querySyncThrottled(
      relays,
      {
        kinds: [6],
        authors: chunk,
        limit,
        ...(until != null ? { until } : {}),
      },
      { maxWait },
    )
  ).filter((e) => e.kind === 6)

  const hasMoreAuthorChunks = chunkIndex + 1 < chunks.length
  const nextUntil = nextUntilCursor(events)
  const thin = events.length < Math.max(2, Math.floor(limit / 3))

  if (hasMoreAuthorChunks) {
    return {
      events,
      nextUntil: until ?? null,
      exhausted: false,
      nextAuthorChunk: chunkIndex + 1,
    }
  }
  if (!thin && nextUntil != null) {
    return {
      events,
      nextUntil,
      exhausted: false,
      nextAuthorChunk: 0,
    }
  }
  return { events, nextUntil: null, exhausted: true, nextAuthorChunk: null }
}

export async function fetchRepostEventsByAuthors(
  authors: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const page = await fetchRepostEventsByAuthorsPage({
    authors,
    relays,
    maxWait,
    limit: FEED_PAGE_SIZE,
  })
  return page.events
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
  maxWait = 3000,
): Promise<Event[]> {
  if (eventIds.length === 0) return []
  const results: Event[] = []
  for (let i = 0; i < eventIds.length; i += ENGAGEMENT_ID_CHUNK) {
    const chunk = eventIds.slice(i, i + ENGAGEMENT_ID_CHUNK)
    const events = await querySyncThrottled(
      relays,
      {
        kinds: [7],
        '#e': chunk,
        limit: ENGAGEMENT_EVENT_LIMIT,
      },
      { maxWait },
    )
    results.push(...events)
  }
  return results
}

export async function fetchCommentsFor(
  eventIds: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 3000,
): Promise<Event[]> {
  if (eventIds.length === 0) return []
  const results: Event[] = []
  for (let i = 0; i < eventIds.length; i += ENGAGEMENT_ID_CHUNK) {
    const chunk = eventIds.slice(i, i + ENGAGEMENT_ID_CHUNK)
    const events = await querySyncThrottled(
      relays,
      {
        kinds: [1],
        '#e': chunk,
        limit: ENGAGEMENT_EVENT_LIMIT,
      },
      { maxWait },
    )
    results.push(...events)
  }
  return results
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
