import { describe, it, expect, afterEach } from 'vitest'
import {
  createEphemeralIdentity,
  hexToNpub,
  parseContactList,
  latestContactList,
  signWithSecretKey,
  secretKeyToHex,
  decodeNsec,
  pubkeyFromSecretKey,
  destroyPool,
  normalizePubkey,
  decodePubkey,
} from './nostr'
import type { Event } from 'nostr-tools'

describe('nostr layer', () => {
  afterEach(() => {
    destroyPool()
  })

  it('creates ephemeral identity with matching npub/hex', () => {
    const id = createEphemeralIdentity()
    expect(id.pubkey).toHaveLength(64)
    expect(id.npub.startsWith('npub1')).toBe(true)
    expect(hexToNpub(id.pubkey)).toBe(id.npub)
    expect(pubkeyFromSecretKey(id.secretKey)).toBe(id.pubkey)
  })

  it('normalizes pubkeys to lowercase for relay queries', () => {
    const id = createEphemeralIdentity()
    expect(normalizePubkey(id.pubkey.toUpperCase())).toBe(id.pubkey)
    expect(decodePubkey(id.pubkey.toUpperCase())).toBe(id.pubkey)
    expect(decodePubkey(id.npub)).toBe(id.pubkey)
  })

  it('round-trips secret key hex encoding', () => {
    const id = createEphemeralIdentity()
    const hex = secretKeyToHex(id.secretKey)
    expect(hex).toHaveLength(64)
    const restored = decodeNsec(hex)
    expect(pubkeyFromSecretKey(restored)).toBe(id.pubkey)
  })

  it('signs an event with ephemeral key', () => {
    const id = createEphemeralIdentity()
    const event = signWithSecretKey(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: 'hello aazaad',
      },
      id.secretKey,
    )
    expect(event.pubkey).toBe(id.pubkey)
    expect(event.id).toHaveLength(64)
    expect(event.sig).toHaveLength(128)
  })

  it('parses Kind 3 contact list tags', () => {
    const follows = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]
    const event = {
      kind: 3,
      tags: [
        ['p', follows[0]],
        ['p', follows[1], 'wss://relay.damus.io'],
        ['p', 'short'],
        ['e', 'noteid'],
      ],
      created_at: 1,
    } as unknown as Event

    expect(parseContactList(event)).toEqual(follows)
  })

  it('selects the newest contact list event', () => {
    const older = { created_at: 100, id: 'a' } as Event
    const newer = { created_at: 200, id: 'b' } as Event
    expect(latestContactList([older, newer])?.id).toBe('b')
    expect(latestContactList([])).toBeNull()
  })
})
