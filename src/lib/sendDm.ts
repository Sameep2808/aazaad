import type { Event, EventTemplate } from 'nostr-tools'
import {
  buildEncryptedDmEvent,
  cacheAndIndexDm,
  isBlocked,
  notifyDmUpdated,
} from './dm'
import { DM_RELAYS, normalizePubkey, publishEventRace } from './nostr'

export async function sendEncryptedDm(opts: {
  ownerPubkey: string
  peerPubkey: string
  plaintext: string
  following: string[]
  encryptDm: (peerPubkey: string, plaintext: string) => Promise<string>
  signEvent: (template: EventTemplate) => Promise<Event>
}): Promise<Event> {
  const owner = normalizePubkey(opts.ownerPubkey)
  const peer = normalizePubkey(opts.peerPubkey)
  const trimmed = opts.plaintext.trim()
  if (!trimmed) throw new Error('Message is empty')
  if (await isBlocked(owner, peer)) {
    throw new Error('You blocked this user')
  }

  const ciphertext = await opts.encryptDm(peer, trimmed)
  const signed = await opts.signEvent(buildEncryptedDmEvent(peer, ciphertext))

  // First relay acceptance is enough for a fast chat feel.
  try {
    await publishEventRace(signed, DM_RELAYS, 5000)
  } catch {
    throw new Error('Could not deliver message — check your connection and try again')
  }

  await cacheAndIndexDm({
    ownerPubkey: owner,
    event: signed,
    plaintext: trimmed,
    following: opts.following,
  })
  notifyDmUpdated({ peer, messageId: signed.id })

  return signed
}
