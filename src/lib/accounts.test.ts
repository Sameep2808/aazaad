import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createAccount,
  loginWithPassword,
  validateUsername,
  validatePassword,
  usernameTaken,
  normalizeUsername,
} from './accounts'
import { db } from './db'

vi.mock('./nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nostr')>()
  return {
    ...actual,
    publishEvent: vi.fn().mockResolvedValue([]),
  }
})

describe('accounts', () => {
  beforeEach(async () => {
    await db.accounts.clear()
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

  it('rejects unknown username', async () => {
    await expect(loginWithPassword('nobody', 'password123')).rejects.toThrow(
      /no account/i,
    )
  })
})
