import type { Event, EventTemplate } from 'nostr-tools'
import {
  buildEncryptedDmEvent,
  cacheAndIndexDm,
  isBlocked,
  publishEvent,
} from './dm'

export async function sendEncryptedDm(opts: {
  ownerPubkey: string
  peerPubkey: string
  plaintext: string
  following: string[]
  encryptDm: (peerPubkey: string, plaintext: string) => Promise<string>
  signEvent: (template: EventTemplate) => Promise<Event>
}): Promise<void> {
  const peer = opts.peerPubkey.toLowerCase()
  const trimmed = opts.plaintext.trim()
  if (!trimmed) throw new Error('Message is empty')
  if (await isBlocked(opts.ownerPubkey, peer)) {
    throw new Error('You blocked this user')
  }

  const ciphertext = await opts.encryptDm(peer, trimmed)
  const signed = await opts.signEvent(buildEncryptedDmEvent(peer, ciphertext))
  await cacheAndIndexDm({
    ownerPubkey: opts.ownerPubkey,
    event: signed,
    plaintext: trimmed,
    following: opts.following,
  })
  void publishEvent(signed)
}
