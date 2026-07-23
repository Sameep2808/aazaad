import type { Event, EventTemplate } from 'nostr-tools'
import {
  DM_RELAYS,
  getPool,
  normalizePubkey,
  publishEvent,
  type Filter,
} from './nostr'
import { db, type DmMessageRow, type DmThreadRow } from './db'

export const DM_KIND = 4 as const
export const DM_UPDATED_EVENT = 'aazaad:dm-updated'

export type DmFolder = 'primary' | 'request'

export function notifyDmUpdated(detail?: {
  peer?: string
  messageId?: string
}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DM_UPDATED_EVENT, { detail }))
}

export function dmThreadKey(ownerPubkey: string, peerPubkey: string): string {
  return `${normalizePubkey(ownerPubkey)}:${normalizePubkey(peerPubkey)}`
}

export function dmBlockKey(ownerPubkey: string, peerPubkey: string): string {
  return `${normalizePubkey(ownerPubkey)}:${normalizePubkey(peerPubkey)}`
}

export function peerFromDmEvent(
  event: Event,
  myPubkey: string,
): string | null {
  const me = normalizePubkey(myPubkey)
  const author = normalizePubkey(event.pubkey)
  if (author === me) {
    const p = event.tags.find((t) => t[0] === 'p')?.[1]
    return p && p.length === 64 ? normalizePubkey(p) : null
  }
  if (event.pubkey.length === 64) return author
  return null
}

export function buildEncryptedDmEvent(
  peerPubkey: string,
  ciphertext: string,
): EventTemplate {
  return {
    kind: DM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', normalizePubkey(peerPubkey)],
      ['client', 'aazaad'],
    ],
    content: ciphertext,
  }
}

function mergeEvents(groups: Event[][]): Event[] {
  const byId = new Map<string, Event>()
  for (const group of groups) {
    for (const event of group) byId.set(event.id, event)
  }
  return [...byId.values()]
}

export async function fetchDmEvents(
  myPubkey: string,
  relays: readonly string[] = DM_RELAYS,
  maxWait = 2800,
): Promise<Event[]> {
  const me = normalizePubkey(myPubkey)
  const pool = getPool()
  const relayList = [...relays]
  const incoming: Filter = {
    kinds: [DM_KIND],
    '#p': [me],
    limit: 200,
  }
  const outgoing: Filter = {
    kinds: [DM_KIND],
    authors: [me],
    limit: 200,
  }
  const [a, b] = await Promise.all([
    pool.querySync(relayList, incoming, { maxWait }),
    pool.querySync(relayList, outgoing, { maxWait }),
  ])
  return mergeEvents([a, b])
}

/** Tight query for one conversation — much faster than full inbox sync. */
export async function fetchPeerDmEvents(
  myPubkey: string,
  peerPubkey: string,
  relays: readonly string[] = DM_RELAYS,
  maxWait = 1600,
): Promise<Event[]> {
  const me = normalizePubkey(myPubkey)
  const peer = normalizePubkey(peerPubkey)
  const pool = getPool()
  const relayList = [...relays]
  const [incoming, outgoing] = await Promise.all([
    pool.querySync(
      relayList,
      { kinds: [DM_KIND], authors: [peer], '#p': [me], limit: 80 },
      { maxWait },
    ),
    pool.querySync(
      relayList,
      { kinds: [DM_KIND], authors: [me], '#p': [peer], limit: 80 },
      { maxWait },
    ),
  ])
  return mergeEvents([incoming, outgoing])
}

/** Live Kind-4 subscription for full inbox. */
export function subscribeDmEvents(
  myPubkey: string,
  onEvent: (event: Event) => void,
  relays: readonly string[] = DM_RELAYS,
): { close: () => void } {
  const me = normalizePubkey(myPubkey)
  const pool = getPool()
  const relayList = [...relays]
  const since = Math.floor(Date.now() / 1000) - 120
  const closerIn = pool.subscribeMany(
    relayList,
    { kinds: [DM_KIND], '#p': [me], since },
    { onevent: onEvent },
  )
  const closerOut = pool.subscribeMany(
    relayList,
    { kinds: [DM_KIND], authors: [me], since },
    { onevent: onEvent },
  )
  return {
    close: () => {
      closerIn.close()
      closerOut.close()
    },
  }
}

/** Live subscription scoped to one peer conversation. */
export function subscribePeerDmEvents(
  myPubkey: string,
  peerPubkey: string,
  onEvent: (event: Event) => void,
  relays: readonly string[] = DM_RELAYS,
): { close: () => void } {
  const me = normalizePubkey(myPubkey)
  const peer = normalizePubkey(peerPubkey)
  const pool = getPool()
  const relayList = [...relays]
  const since = Math.floor(Date.now() / 1000) - 120
  const closerIn = pool.subscribeMany(
    relayList,
    { kinds: [DM_KIND], authors: [peer], '#p': [me], since },
    { onevent: onEvent },
  )
  const closerOut = pool.subscribeMany(
    relayList,
    { kinds: [DM_KIND], authors: [me], '#p': [peer], since },
    { onevent: onEvent },
  )
  return {
    close: () => {
      closerIn.close()
      closerOut.close()
    },
  }
}

export async function isBlocked(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<boolean> {
  const row = await db.dmBlocks.get(dmBlockKey(ownerPubkey, peerPubkey))
  return Boolean(row)
}

export async function blockPeer(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<void> {
  const owner = normalizePubkey(ownerPubkey)
  const peer = normalizePubkey(peerPubkey)
  const key = dmBlockKey(owner, peer)
  await db.dmBlocks.put({
    key,
    ownerPubkey: owner,
    peerPubkey: peer,
    blockedAt: Date.now(),
  })
  await db.dmThreads.delete(dmThreadKey(owner, peer))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('aazaad:blocks-changed'))
  }
}

export async function unblockPeer(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<void> {
  await db.dmBlocks.delete(dmBlockKey(ownerPubkey, peerPubkey))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('aazaad:blocks-changed'))
  }
}

export async function isAcceptedPeer(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<boolean> {
  const row = await db.dmAccepted.get(dmThreadKey(ownerPubkey, peerPubkey))
  return Boolean(row)
}

export async function acceptRequest(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<void> {
  const owner = normalizePubkey(ownerPubkey)
  const peer = normalizePubkey(peerPubkey)
  const key = dmThreadKey(owner, peer)
  await db.dmAccepted.put({
    key,
    ownerPubkey: owner,
    peerPubkey: peer,
    acceptedAt: Date.now(),
  })
  const thread = await db.dmThreads.get(key)
  if (thread) {
    await db.dmThreads.update(key, { folder: 'primary', updatedAt: Date.now() })
  }
}

/**
 * Primary if you follow them, already accepted, or you have sent them a message.
 * Otherwise incoming-only strangers stay in Requests.
 */
export async function resolveDmFolder(
  ownerPubkey: string,
  peerPubkey: string,
  following: string[],
): Promise<DmFolder> {
  const owner = normalizePubkey(ownerPubkey)
  const peer = normalizePubkey(peerPubkey)
  const follows = new Set(following.map(normalizePubkey))
  if (follows.has(peer)) return 'primary'
  if (await isAcceptedPeer(owner, peer)) return 'primary'

  const sent = await db.dmMessages
    .where('[ownerPubkey+peerPubkey]')
    .equals([owner, peer])
    .filter((m) => m.direction === 'out')
    .first()
  if (sent) return 'primary'

  return 'request'
}

export async function upsertDmMessage(row: DmMessageRow): Promise<void> {
  await db.dmMessages.put({
    ...row,
    ownerPubkey: normalizePubkey(row.ownerPubkey),
    peerPubkey: normalizePubkey(row.peerPubkey),
  })
}

export async function upsertDmThread(
  partial: Omit<DmThreadRow, 'updatedAt'> & { updatedAt?: number },
): Promise<void> {
  const ownerPubkey = normalizePubkey(partial.ownerPubkey)
  const peerPubkey = normalizePubkey(partial.peerPubkey)
  await db.dmThreads.put({
    ...partial,
    key: dmThreadKey(ownerPubkey, peerPubkey),
    ownerPubkey,
    peerPubkey,
    updatedAt: partial.updatedAt ?? Date.now(),
  })
}

export async function loadThreads(
  ownerPubkey: string,
  folder: DmFolder,
): Promise<DmThreadRow[]> {
  const owner = normalizePubkey(ownerPubkey)
  const rows = await db.dmThreads
    .where('[ownerPubkey+folder]')
    .equals([owner, folder])
    .toArray()
  return rows.sort((a, b) => b.lastAt - a.lastAt)
}

export async function loadMessages(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<DmMessageRow[]> {
  return db.dmMessages
    .where('[ownerPubkey+peerPubkey]')
    .equals([
      normalizePubkey(ownerPubkey),
      normalizePubkey(peerPubkey),
    ])
    .sortBy('createdAt')
}

export async function cacheAndIndexDm(opts: {
  ownerPubkey: string
  event: Event
  plaintext: string
  following: string[]
}): Promise<{ peer: string; folder: DmFolder } | null> {
  const ownerPubkey = normalizePubkey(opts.ownerPubkey)
  const { event, plaintext, following } = opts
  const peer = peerFromDmEvent(event, ownerPubkey)
  if (!peer || peer === ownerPubkey) return null
  if (await isBlocked(ownerPubkey, peer)) return null

  const direction: 'in' | 'out' =
    normalizePubkey(event.pubkey) === ownerPubkey ? 'out' : 'in'

  await upsertDmMessage({
    id: event.id,
    ownerPubkey,
    peerPubkey: peer,
    createdAt: event.created_at * 1000,
    content: plaintext,
    direction,
    eventJson: JSON.stringify(event),
  })

  let folder = await resolveDmFolder(ownerPubkey, peer, following)
  // Outgoing always opens/keeps primary
  if (direction === 'out') folder = 'primary'

  const existing = await db.dmThreads.get(dmThreadKey(ownerPubkey, peer))
  const unreadBump =
    direction === 'in' ? (existing?.unread ?? 0) + 1 : (existing?.unread ?? 0)

  await upsertDmThread({
    key: dmThreadKey(ownerPubkey, peer),
    ownerPubkey,
    peerPubkey: peer,
    folder,
    lastAt: event.created_at * 1000,
    lastPreview: plaintext.slice(0, 140),
    unread: direction === 'in' ? unreadBump : 0,
  })

  notifyDmUpdated({ peer, messageId: event.id })
  return { peer, folder }
}

const DECRYPT_CONCURRENCY = 6

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0
  async function run() {
    while (index < items.length) {
      const current = items[index++]
      if (current === undefined) return
      await worker(current)
    }
  }
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    () => run(),
  )
  await Promise.all(runners)
}

/**
 * Decrypt + index DM events that are not already cached locally.
 * Returns how many new messages were stored.
 */
export async function ingestDmEvents(opts: {
  ownerPubkey: string
  events: Event[]
  following: string[]
  decryptDm: (peerPubkey: string, ciphertext: string) => Promise<string>
}): Promise<number> {
  const owner = normalizePubkey(opts.ownerPubkey)
  const pending: Event[] = []

  for (const event of opts.events) {
    const peer = peerFromDmEvent(event, owner)
    if (!peer) continue
    if (await isBlocked(owner, peer)) continue
    if (await db.dmMessages.get(event.id)) continue
    pending.push(event)
  }

  let stored = 0
  await mapPool(pending, DECRYPT_CONCURRENCY, async (event) => {
    const peer = peerFromDmEvent(event, owner)
    if (!peer) return
    try {
      const plaintext = await opts.decryptDm(peer, event.content)
      const indexed = await cacheAndIndexDm({
        ownerPubkey: owner,
        event,
        plaintext,
        following: opts.following,
      })
      if (indexed) stored += 1
    } catch {
      // skip undecryptable / foreign
    }
  })
  return stored
}

/** Fetch from relays, decrypt, and cache. */
export async function syncDmsFromRelays(opts: {
  ownerPubkey: string
  following: string[]
  decryptDm: (peerPubkey: string, ciphertext: string) => Promise<string>
}): Promise<number> {
  const events = await fetchDmEvents(opts.ownerPubkey)
  return ingestDmEvents({
    ownerPubkey: opts.ownerPubkey,
    events,
    following: opts.following,
    decryptDm: opts.decryptDm,
  })
}

/** Fast peer-scoped sync for an open chat. */
export async function syncPeerDmsFromRelays(opts: {
  ownerPubkey: string
  peerPubkey: string
  following: string[]
  decryptDm: (peerPubkey: string, ciphertext: string) => Promise<string>
}): Promise<number> {
  const events = await fetchPeerDmEvents(opts.ownerPubkey, opts.peerPubkey)
  return ingestDmEvents({
    ownerPubkey: opts.ownerPubkey,
    events,
    following: opts.following,
    decryptDm: opts.decryptDm,
  })
}

export async function markThreadRead(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<void> {
  const key = dmThreadKey(ownerPubkey, peerPubkey)
  const row = await db.dmThreads.get(key)
  if (row) await db.dmThreads.update(key, { unread: 0, updatedAt: Date.now() })
}

export { publishEvent }
