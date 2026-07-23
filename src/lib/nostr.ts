import {
  SimplePool,
  type Event,
  type EventTemplate,
  type Filter,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from 'nostr-tools'
import { npubEncode, nsecEncode, decode } from 'nostr-tools/nip19'

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.0xchat.com',
  'wss://nostr.mom',
] as const

/** Relays preferred for Kind-4 DMs (fast + reliable for chat). */
export const DM_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.0xchat.com',
  'wss://nostr.mom',
] as const

function isPublishFailure(value: unknown): boolean {
  return (
    typeof value === 'string' && value.startsWith('connection failure:')
  )
}

/** Singleton pool for the app lifetime */
let pool: SimplePool | null = null

export function getPool(): SimplePool {
  if (!pool) {
    pool = new SimplePool({ enableReconnect: true })
  }
  return pool
}

export function destroyPool(): void {
  if (pool) {
    pool.destroy()
    pool = null
  }
}

export function hexToNpub(hexPubkey: string): string {
  return npubEncode(hexPubkey)
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

/** Decode npub / nprofile / hex pubkey → 64-char hex. Returns null if invalid. */
export function decodePubkey(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (HEX_PUBKEY_RE.test(raw)) return raw.toLowerCase()

  try {
    if (raw.startsWith('npub1') || raw.startsWith('nprofile1')) {
      const decoded = decode(raw)
      if (decoded.type === 'npub') return decoded.data.toLowerCase()
      if (decoded.type === 'nprofile') return decoded.data.pubkey.toLowerCase()
    }
  } catch {
    return null
  }
  return null
}

/** Relays match hex pubkeys case-sensitively — always store/query lowercase. */
export function normalizePubkey(hex: string): string {
  return hex.trim().toLowerCase()
}

/** Build / replace Kind 3 contact list (follow graph). */
export function buildContactListEvent(following: string[]): EventTemplate {
  const unique = [...new Set(following.filter((pk) => HEX_PUBKEY_RE.test(pk)))]
  return {
    kind: 3,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ...unique.map((pk) => ['p', pk.toLowerCase()]),
      ['client', 'aazaad'],
    ],
    content: '',
  }
}

export function hexToNsec(secretKey: Uint8Array): string {
  return nsecEncode(secretKey)
}

export function createEphemeralIdentity(): {
  secretKey: Uint8Array
  pubkey: string
  npub: string
} {
  const secretKey = generateSecretKey()
  const pubkey = getPublicKey(secretKey)
  return { secretKey, pubkey, npub: npubEncode(pubkey) }
}

export function pubkeyFromSecretKey(secretKey: Uint8Array): string {
  return getPublicKey(secretKey)
}

export function decodeNsec(nsecOrHex: string): Uint8Array {
  if (nsecOrHex.startsWith('nsec1')) {
    const decoded = decode(nsecOrHex)
    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec')
    }
    return decoded.data
  }
  // raw hex
  const bytes = new Uint8Array(nsecOrHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(nsecOrHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function secretKeyToHex(secretKey: Uint8Array): string {
  return Array.from(secretKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Extract follow pubkeys from a Kind 3 contact list event */
export function parseContactList(event: Event): string[] {
  const following = event.tags
    .filter((tag) => tag[0] === 'p' && typeof tag[1] === 'string' && tag[1].length === 64)
    .map((tag) => (tag[1] as string).toLowerCase())
  // de-dupe while preserving order
  return [...new Set(following)]
}

/** Pick the newest Kind 3 event from a list */
export function latestContactList(events: Event[]): Event | null {
  if (events.length === 0) return null
  return events.reduce((a, b) => (a.created_at >= b.created_at ? a : b))
}

export async function fetchContactListEvents(
  pubkey: string,
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 2500,
): Promise<Event[]> {
  const filter: Filter = { kinds: [3], authors: [pubkey], limit: 5 }
  return getPool().querySync([...relays], filter, { maxWait })
}

/**
 * Fetch Kind 3 events that tag this pubkey as a follow target.
 * Used to derive an approximate follower list from relays.
 */
export async function fetchFollowerCandidateEvents(
  pubkey: string,
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 2800,
): Promise<Event[]> {
  const filter: Filter = { kinds: [3], '#p': [pubkey], limit: 300 }
  return getPool().querySync([...relays], filter, { maxWait })
}

/**
 * From Kind 3 events mentioning `pubkey`, keep authors whose *latest*
 * contact list still includes `pubkey`.
 */
export function deriveFollowersFromKind3(
  targetPubkey: string,
  events: Event[],
): string[] {
  const latestByAuthor = new Map<string, Event>()
  for (const event of events) {
    const prev = latestByAuthor.get(event.pubkey)
    if (!prev || event.created_at >= prev.created_at) {
      latestByAuthor.set(event.pubkey, event)
    }
  }

  const followers: string[] = []
  for (const [author, event] of latestByAuthor) {
    if (author === targetPubkey) continue
    const list = parseContactList(event)
    if (list.includes(targetPubkey)) {
      followers.push(author)
    }
  }
  return followers
}

/** Post kinds: text notes + common video/short kinds (NIP-71 related). */
export const POST_KINDS = [1, 21, 22, 34235] as const

export async function fetchUserPostEvents(
  pubkey: string,
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const filter: Filter = {
    kinds: [...POST_KINDS],
    authors: [pubkey],
    limit: 500,
  }
  return getPool().querySync([...relays], filter, { maxWait })
}

export function countUniquePosts(events: Event[]): number {
  return new Set(events.map((e) => e.id)).size
}

export interface NostrProfileMetadata {
  name?: string
  display_name?: string
  about?: string
  picture?: string
}

export function parseProfileMetadata(event: Event | null): NostrProfileMetadata {
  if (!event?.content) return {}
  try {
    return JSON.parse(event.content) as NostrProfileMetadata
  } catch {
    return {}
  }
}

export async function fetchProfileMetadata(
  pubkey: string,
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 3000,
): Promise<NostrProfileMetadata> {
  const filter: Filter = { kinds: [0], authors: [pubkey], limit: 1 }
  const events = await getPool().querySync([...relays], filter, { maxWait })
  const latest =
    events.length === 0
      ? null
      : events.reduce((a, b) => (a.created_at >= b.created_at ? a : b))
  return parseProfileMetadata(latest)
}

/**
 * Publish to relays. Returns URLs that accepted the event.
 * Note: nostr-tools resolves some connection failures as fulfilled strings
 * starting with "connection failure:" — those are treated as failures here.
 */
export async function publishEvent(
  event: Event,
  relays: readonly string[] = DEFAULT_RELAYS,
): Promise<string[]> {
  const relayList = [...relays]
  const results = await Promise.allSettled(
    getPool().publish(relayList, event),
  )
  const accepted: string[] = []
  for (let i = 0; i < relayList.length; i++) {
    const result = results[i]
    const url = relayList[i]
    if (!result || !url) continue
    if (result.status !== 'fulfilled') continue
    if (isPublishFailure(result.value)) continue
    accepted.push(url)
  }
  return accepted
}

/**
 * Resolve as soon as the first relay accepts. Other publishes keep going
 * in the background so chat stays snappy.
 */
export function publishEventRace(
  event: Event,
  relays: readonly string[] = DEFAULT_RELAYS,
  timeoutMs = 4500,
): Promise<string> {
  const relayList = [...relays]
  if (relayList.length === 0) {
    return Promise.reject(new Error('No relays configured'))
  }

  return new Promise((resolve, reject) => {
    let remaining = relayList.length
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      reject(new Error('Publish timed out'))
    }, timeoutMs)

    const finishOk = (url: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(url)
    }

    const finishFail = () => {
      remaining -= 1
      if (!done && remaining <= 0) {
        done = true
        clearTimeout(timer)
        reject(new Error('Could not reach any relay'))
      }
    }

    const pubs = getPool().publish(relayList, event)
    for (let i = 0; i < pubs.length; i++) {
      const url = relayList[i]!
      pubs[i]!
        .then((value) => {
          if (isPublishFailure(value)) {
            finishFail()
            return
          }
          finishOk(url)
        })
        .catch(() => finishFail())
    }
  })
}

export function signWithSecretKey(
  template: EventTemplate,
  secretKey: Uint8Array,
): Event {
  return finalizeEvent(template, secretKey)
}

export type { Event, EventTemplate, Filter }
