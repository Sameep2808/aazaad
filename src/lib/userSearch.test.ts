import { describe, it, expect, beforeEach } from 'vitest'
import {
  createEphemeralIdentity,
  decodePubkey,
  hexToNpub,
  buildContactListEvent,
} from './nostr'
import { db } from './db'
import { createAccount } from './accounts'
import { parseUserQuery, searchUsers } from './userSearch'
import { saveProfileRow } from './profiles'

describe('decodePubkey / contact list', () => {
  it('decodes npub and hex', () => {
    const id = createEphemeralIdentity()
    expect(decodePubkey(id.npub)).toBe(id.pubkey)
    expect(decodePubkey(id.pubkey)).toBe(id.pubkey)
    expect(decodePubkey('not-a-key')).toBeNull()
  })

  it('builds Kind 3 follow list', () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    const event = buildContactListEvent([a, b, a])
    expect(event.kind).toBe(3)
    expect(event.tags.filter((t) => t[0] === 'p')).toHaveLength(2)
  })
})

describe('user search', () => {
  beforeEach(async () => {
    await db.accounts.clear()
    await db.profiles.clear()
  })

  it('parses @userid, npub, and empty', () => {
    expect(parseUserQuery('  @Alice ').kind).toBe('username')
    expect(parseUserQuery('  @Alice ').value).toBe('alice')
    const id = createEphemeralIdentity()
    expect(parseUserQuery(id.npub)).toEqual({
      kind: 'pubkey',
      value: id.pubkey,
      raw: id.npub,
    })
    expect(parseUserQuery('').kind).toBe('empty')
  })

  it('finds local accounts by username prefix', async () => {
    await createAccount('alice', 'password123')
    await createAccount('alex', 'password123')
    await createAccount('bob', 'password123')

    const hits = await searchUsers('al')
    const names = hits.map((h) => h.username).sort()
    expect(names).toEqual(['alex', 'alice'])
  })

  it('resolves an npub to a single profile', async () => {
    const id = createEphemeralIdentity()
    await saveProfileRow({
      pubkey: id.pubkey,
      username: 'carol',
      displayName: 'Carol',
      picture: null,
      pictureCid: null,
      updatedAt: Date.now(),
    })

    const hits = await searchUsers(hexToNpub(id.pubkey))
    expect(hits).toHaveLength(1)
    expect(hits[0]?.pubkey).toBe(id.pubkey)
    expect(hits[0]?.username).toBe('carol')
  })
})
