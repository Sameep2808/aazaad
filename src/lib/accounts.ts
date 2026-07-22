import { encrypt, decrypt } from 'nostr-tools/nip49'
import {
  createEphemeralIdentity,
  publishEvent,
  signWithSecretKey,
} from './nostr'
import { db, type AccountRow } from './db'
import {
  metadataToProfileRow,
  saveProfileRow,
} from './profiles'

const USERNAME_RE = /^[a-z0-9_]{3,30}$/

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export function validateUsername(username: string): string | null {
  const normalized = normalizeUsername(username)
  if (!USERNAME_RE.test(normalized)) {
    return 'Username must be 3–30 characters: lowercase letters, numbers, underscore'
  }
  return null
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters'
  }
  return null
}

export async function usernameTaken(username: string): Promise<boolean> {
  const row = await db.accounts.get(normalizeUsername(username))
  return Boolean(row)
}

export async function listAccounts(): Promise<AccountRow[]> {
  return db.accounts.orderBy('createdAt').reverse().toArray()
}

export async function getAccountByUsername(
  username: string,
): Promise<AccountRow | undefined> {
  return db.accounts.get(normalizeUsername(username))
}

export async function getAccountByPubkey(
  pubkey: string,
): Promise<AccountRow | undefined> {
  return db.accounts.where('pubkey').equals(pubkey).first()
}

export interface CreatedAccount {
  username: string
  pubkey: string
  secretKey: Uint8Array
}

/**
 * Create a local account: generate Nostr keypair, encrypt with password (NIP-49),
 * store in IndexedDB, and best-effort publish Kind 0 profile metadata.
 */
export async function createAccount(
  username: string,
  password: string,
): Promise<CreatedAccount> {
  const usernameError = validateUsername(username)
  if (usernameError) throw new Error(usernameError)
  const passwordError = validatePassword(password)
  if (passwordError) throw new Error(passwordError)

  const normalized = normalizeUsername(username)
  if (await usernameTaken(normalized)) {
    throw new Error('Username is already taken on this device')
  }

  const identity = createEphemeralIdentity()
  const encryptedNsec = encrypt(identity.secretKey, password)
  const now = Date.now()

  await db.accounts.put({
    username: normalized,
    pubkey: identity.pubkey,
    encryptedNsec,
    createdAt: now,
    updatedAt: now,
  })

  await saveProfileRow(
    metadataToProfileRow(identity.pubkey, {
      name: normalized,
      display_name: normalized,
      about: 'aazaad user',
    }),
  )

  // Publish Kind 0 metadata so relays know the display name
  try {
    const metadata = {
      name: normalized,
      display_name: normalized,
      about: 'aazaad user',
    }
    const event = signWithSecretKey(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(metadata),
      },
      identity.secretKey,
    )
    await publishEvent(event)
  } catch {
    // Offline / relay failure should not block local account creation
  }

  return {
    username: normalized,
    pubkey: identity.pubkey,
    secretKey: identity.secretKey,
  }
}

/**
 * Unlock a local account with username + password.
 */
export async function loginWithPassword(
  username: string,
  password: string,
): Promise<CreatedAccount> {
  const normalized = normalizeUsername(username)
  const account = await getAccountByUsername(normalized)
  if (!account) {
    throw new Error('No account found with that username')
  }

  let secretKey: Uint8Array
  try {
    secretKey = decrypt(account.encryptedNsec, password)
  } catch {
    throw new Error('Incorrect password')
  }

  return {
    username: account.username,
    pubkey: account.pubkey,
    secretKey,
  }
}
