import type { Event, EventTemplate } from 'nostr-tools'
import { DEFAULT_RELAYS, getPool, publishEvent, type Filter } from './nostr'
import { db, type DmMessageRow, type DmThreadRow } from './db'

export const DM_KIND = 4 as const

export type DmFolder = 'primary' | 'request'

export function dmThreadKey(ownerPubkey: string, peerPubkey: string): string {
  return `${ownerPubkey}:${peerPubkey}`
}

export function dmBlockKey(ownerPubkey: string, peerPubkey: string): string {
  return `${ownerPubkey}:${peerPubkey}`
}

export function peerFromDmEvent(
  event: Event,
  myPubkey: string,
): string | null {
  if (event.pubkey === myPubkey) {
    const p = event.tags.find((t) => t[0] === 'p')?.[1]
    return p && p.length === 64 ? p.toLowerCase() : null
  }
  if (event.pubkey.length === 64) return event.pubkey.toLowerCase()
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
      ['p', peerPubkey.toLowerCase()],
      ['client', 'aazaad'],
    ],
    content: ciphertext,
  }
}

export async function fetchDmEvents(
  myPubkey: string,
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 5000,
): Promise<Event[]> {
  const pool = getPool()
  const relayList = [...relays]
  const incoming: Filter = {
    kinds: [DM_KIND],
    '#p': [myPubkey],
    limit: 200,
  }
  const outgoing: Filter = {
    kinds: [DM_KIND],
    authors: [myPubkey],
    limit: 200,
  }
  const [a, b] = await Promise.all([
    pool.querySync(relayList, incoming, { maxWait }),
    pool.querySync(relayList, outgoing, { maxWait }),
  ])
  const byId = new Map<string, Event>()
  for (const event of [...a, ...b]) byId.set(event.id, event)
  return [...byId.values()]
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
  const key = dmBlockKey(ownerPubkey, peerPubkey)
  await db.dmBlocks.put({
    key,
    ownerPubkey,
    peerPubkey: peerPubkey.toLowerCase(),
    blockedAt: Date.now(),
  })
  const threadKey = dmThreadKey(ownerPubkey, peerPubkey)
  await db.dmThreads.delete(threadKey)
}

export async function unblockPeer(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<void> {
  await db.dmBlocks.delete(dmBlockKey(ownerPubkey, peerPubkey))
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
  const key = dmThreadKey(ownerPubkey, peerPubkey)
  await db.dmAccepted.put({
    key,
    ownerPubkey,
    peerPubkey: peerPubkey.toLowerCase(),
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
  if (following.includes(peerPubkey)) return 'primary'
  if (await isAcceptedPeer(ownerPubkey, peerPubkey)) return 'primary'

  const sent = await db.dmMessages
    .where('[ownerPubkey+peerPubkey]')
    .equals([ownerPubkey, peerPubkey])
    .filter((m) => m.direction === 'out')
    .first()
  if (sent) return 'primary'

  return 'request'
}

export async function upsertDmMessage(
  row: DmMessageRow,
): Promise<void> {
  await db.dmMessages.put(row)
}

export async function upsertDmThread(
  partial: Omit<DmThreadRow, 'updatedAt'> & { updatedAt?: number },
): Promise<void> {
  await db.dmThreads.put({
    ...partial,
    updatedAt: partial.updatedAt ?? Date.now(),
  })
}

export async function loadThreads(
  ownerPubkey: string,
  folder: DmFolder,
): Promise<DmThreadRow[]> {
  const rows = await db.dmThreads
    .where('[ownerPubkey+folder]')
    .equals([ownerPubkey, folder])
    .toArray()
  return rows.sort((a, b) => b.lastAt - a.lastAt)
}

export async function loadMessages(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<DmMessageRow[]> {
  return db.dmMessages
    .where('[ownerPubkey+peerPubkey]')
    .equals([ownerPubkey, peerPubkey.toLowerCase()])
    .sortBy('createdAt')
}

export async function cacheAndIndexDm(opts: {
  ownerPubkey: string
  event: Event
  plaintext: string
  following: string[]
}): Promise<{ peer: string; folder: DmFolder } | null> {
  const { ownerPubkey, event, plaintext, following } = opts
  const peer = peerFromDmEvent(event, ownerPubkey)
  if (!peer || peer === ownerPubkey) return null
  if (await isBlocked(ownerPubkey, peer)) return null

  const direction: 'in' | 'out' =
    event.pubkey === ownerPubkey ? 'out' : 'in'

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

  return { peer, folder }
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
