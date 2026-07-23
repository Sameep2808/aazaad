import { describe, it, expect, beforeEach } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import * as nip04 from 'nostr-tools/nip04'
import { db } from './db'
import {
  acceptRequest,
  blockPeer,
  buildEncryptedDmEvent,
  cacheAndIndexDm,
  isBlocked,
  loadThreads,
  peerFromDmEvent,
  resolveDmFolder,
} from './dm'

describe('dm helpers', () => {
  const aliceSk = generateSecretKey()
  const bobSk = generateSecretKey()
  const alice = getPublicKey(aliceSk)
  const bob = getPublicKey(bobSk)

  beforeEach(async () => {
    await db.dmMessages.clear()
    await db.dmThreads.clear()
    await db.dmBlocks.clear()
    await db.dmAccepted.clear()
  })

  it('builds Kind 4 DM and resolves peer', () => {
    const event = finalizeEvent(
      buildEncryptedDmEvent(bob, 'cipher'),
      aliceSk,
    )
    expect(event.kind).toBe(4)
    expect(peerFromDmEvent(event, alice)).toBe(bob)
    expect(peerFromDmEvent(event, bob)).toBe(alice)
  })

  it('puts stranger inbound messages in requests until accepted', async () => {
    const plaintext = 'hey from stranger'
    const ciphertext = nip04.encrypt(bobSk, alice, plaintext)
    const event = finalizeEvent(
      buildEncryptedDmEvent(alice, ciphertext),
      bobSk,
    )

    const indexed = await cacheAndIndexDm({
      ownerPubkey: alice,
      event,
      plaintext,
      following: [],
    })
    expect(indexed?.folder).toBe('request')

    const requests = await loadThreads(alice, 'request')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.peerPubkey).toBe(bob)

    await acceptRequest(alice, bob)
    expect(await resolveDmFolder(alice, bob, [])).toBe('primary')

    const primary = await loadThreads(alice, 'primary')
    expect(primary.some((t) => t.peerPubkey === bob)).toBe(true)
  })

  it('treats followed peers as primary', async () => {
    const plaintext = 'hi friend'
    const ciphertext = nip04.encrypt(bobSk, alice, plaintext)
    const event = finalizeEvent(
      buildEncryptedDmEvent(alice, ciphertext),
      bobSk,
    )

    const indexed = await cacheAndIndexDm({
      ownerPubkey: alice,
      event,
      plaintext,
      following: [bob],
    })
    expect(indexed?.folder).toBe('primary')
  })

  it('blocks a peer and hides future indexing', async () => {
    await blockPeer(alice, bob)
    expect(await isBlocked(alice, bob)).toBe(true)

    const plaintext = 'blocked'
    const ciphertext = nip04.encrypt(bobSk, alice, plaintext)
    const event = finalizeEvent(
      buildEncryptedDmEvent(alice, ciphertext),
      bobSk,
    )
    const indexed = await cacheAndIndexDm({
      ownerPubkey: alice,
      event,
      plaintext,
      following: [],
    })
    expect(indexed).toBeNull()
  })

  it('resolves peers case-insensitively (relays are case-sensitive)', () => {
    const event = finalizeEvent(
      buildEncryptedDmEvent(bob, 'cipher'),
      aliceSk,
    )
    expect(peerFromDmEvent(event, alice.toUpperCase())).toBe(bob)
    expect(peerFromDmEvent(event, alice)).toBe(bob)
  })

  it('indexes outbound then inbound for a two-way chat', async () => {
    const hello = 'hey bob'
    const cipherOut = nip04.encrypt(aliceSk, bob, hello)
    const outEvent = finalizeEvent(
      buildEncryptedDmEvent(bob, cipherOut),
      aliceSk,
    )
    await cacheAndIndexDm({
      ownerPubkey: alice,
      event: outEvent,
      plaintext: hello,
      following: [],
    })

    const reply = 'hey alice'
    const cipherIn = nip04.encrypt(bobSk, alice, reply)
    const inEvent = finalizeEvent(
      buildEncryptedDmEvent(alice, cipherIn),
      bobSk,
    )
    await cacheAndIndexDm({
      ownerPubkey: alice,
      event: inEvent,
      plaintext: reply,
      following: [],
    })

    const { loadMessages } = await import('./dm')
    const messages = await loadMessages(alice, bob)
    expect(messages.map((m) => m.content)).toEqual([hello, reply])
    expect(messages.map((m) => m.direction)).toEqual(['out', 'in'])
  })
})
