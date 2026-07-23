import { describe, it, expect, beforeEach, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { encrypt } from 'nostr-tools/nip49'
import {
  createAccount,
  loginWithPassword,
  validateUsername,
  validatePassword,
  usernameTaken,
  normalizeUsername,
} from './accounts'
import { db } from './db'

const { querySync, publishEvent } = vi.hoisted(() => ({
  querySync: vi.fn(),
  publishEvent: vi.fn().mockResolvedValue([]),
}))

vi.mock('./nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nostr')>()
  return {
    ...actual,
    getPool: () => ({ querySync }),
    publishEvent,
  }
})

describe('accounts', () => {
  beforeEach(async () => {
    await db.accounts.clear()
    await db.profiles.clear()
    querySync.mockReset()
    querySync.mockResolvedValue([])
    publishEvent.mockClear()
  })

  it('validates username and password rules', () => {
    expect(validateUsername('ab')).toBeTruthy()
    expect(validateUsername('Valid_User_1')).toBeNull()
    expect(normalizeUsername('Valid_User_1')).toBe('valid_user_1')
    expect(validatePassword('short')).toBeTruthy()
    expect(validatePassword('longenough')).toBeNull()
  })

  it('creates an account and unlocks with password', async () => {
    const created = await createAccount('alice', 'password123')
    expect(created.username).toBe('alice')
    expect(created.pubkey).toHaveLength(64)
    expect(await usernameTaken('alice')).toBe(true)

    const unlocked = await loginWithPassword('Alice', 'password123')
    expect(unlocked.pubkey).toBe(created.pubkey)
  })

  it('publishes Kind 0 with NIP-49 backup on signup', async () => {
    await createAccount('backup_user', 'password123')
    expect(publishEvent).toHaveBeenCalled()
    const event = publishEvent.mock.calls[0][0] as {
      kind: number
      content: string
    }
    expect(event.kind).toBe(0)
    const content = JSON.parse(event.content) as {
      name: string
      aazaad_ncryptsec: string
    }
    expect(content.name).toBe('backup_user')
    expect(content.aazaad_ncryptsec).toMatch(/^ncryptsec1/)
  })

  it('rejects duplicate usernames', async () => {
    await createAccount('bob', 'password123')
    await expect(createAccount('bob', 'password456')).rejects.toThrow(/taken/i)
  })

  it('rejects wrong password', async () => {
    await createAccount('carol', 'password123')
    await expect(loginWithPassword('carol', 'wrong-password')).rejects.toThrow(
      /incorrect password/i,
    )
  })

  it('rejects unknown username when relays have no backup', async () => {
    querySync.mockResolvedValue([])
    await expect(loginWithPassword('nobody', 'password123')).rejects.toThrow(
      /no account/i,
    )
  })

  it('restores account from relay backup on another device', async () => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const password = 'password123'
    const encryptedNsec = encrypt(sk, password)
    const kind0 = finalizeEvent(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['client', 'aazaad']],
        content: JSON.stringify({
          name: 'remote_alice',
          display_name: 'remote_alice',
          about: 'aazaad user',
          aazaad_ncryptsec: encryptedNsec,
        }),
      },
      sk,
    )
    querySync.mockResolvedValue([kind0])

    // Simulate empty device B IndexedDB
    expect(await db.accounts.count()).toBe(0)

    const unlocked = await loginWithPassword('remote_alice', password)
    expect(unlocked.pubkey).toBe(pubkey)
    expect(unlocked.username).toBe('remote_alice')

    // Cached locally for offline unlock next time
    const local = await db.accounts.get('remote_alice')
    expect(local?.pubkey).toBe(pubkey)
    expect(local?.encryptedNsec).toBe(encryptedNsec)
  })

  it('rejects wrong password against remote backup', async () => {
    const sk = generateSecretKey()
    const encryptedNsec = encrypt(sk, 'password123')
    const kind0 = finalizeEvent(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify({
          name: 'remote_bob',
          aazaad_ncryptsec: encryptedNsec,
        }),
      },
      sk,
    )
    querySync.mockResolvedValue([kind0])

    await expect(
      loginWithPassword('remote_bob', 'wrong-password'),
    ).rejects.toThrow(/incorrect password/i)
  })
})
