import { encrypt, decrypt } from 'nostr-tools/nip49'
import { getPublicKey, type Event } from 'nostr-tools'
import {
  createEphemeralIdentity,
  DEFAULT_RELAYS,
  getPool,
  hasAazaadEncryptedKey,
  parseProfileMetadata,
  publishEvent,
  signWithSecretKey,
  type Filter,
  type NostrProfileMetadata,
} from './nostr'
import { db, type AccountRow } from './db'
import {
  buildProfileMetadataEvent,
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

function profileMatchesUsername(
  meta: NostrProfileMetadata,
  username: string,
): boolean {
  const name = (meta.name ?? '').trim().toLowerCase()
  const display = (meta.display_name ?? '').trim().toLowerCase()
  return name === username || display === username
}

/**
 * Find Kind 0 profiles on relays that claim this username and carry an
 * aazaad NIP-49 backup (for cross-device password login).
 */
export async function findRemoteAccountBackups(
  username: string,
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 4500,
): Promise<Array<{ pubkey: string; encryptedNsec: string; meta: NostrProfileMetadata }>> {
  const normalized = normalizeUsername(username)
  const pool = getPool()
  const filter: Filter = {
    kinds: [0],
    search: normalized,
    limit: 40,
  }

  let events: Event[] = []
  try {
    events = await pool.querySync([...relays], filter, { maxWait })
  } catch {
    return []
  }

  const latestByAuthor = new Map<string, Event>()
  for (const event of events) {
    const prev = latestByAuthor.get(event.pubkey)
    if (!prev || event.created_at >= prev.created_at) {
      latestByAuthor.set(event.pubkey, event)
    }
  }

  const hits: Array<{
    pubkey: string
    encryptedNsec: string
    meta: NostrProfileMetadata
  }> = []

  for (const [pubkey, event] of latestByAuthor) {
    const meta = parseProfileMetadata(event)
    if (!profileMatchesUsername(meta, normalized)) continue
    if (!hasAazaadEncryptedKey(meta)) continue
    hits.push({
      pubkey: pubkey.toLowerCase(),
      encryptedNsec: meta.aazaad_ncryptsec,
      meta,
    })
  }

  return hits
}

async function saveLocalAccount(opts: {
  username: string
  pubkey: string
  encryptedNsec: string
}): Promise<void> {
  const now = Date.now()
  const existing = await getAccountByUsername(opts.username)
  await db.accounts.put({
    username: opts.username,
    pubkey: opts.pubkey,
    encryptedNsec: opts.encryptedNsec,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
}

function buildSignupMetadata(
  username: string,
  encryptedNsec: string,
): NostrProfileMetadata {
  return {
    name: username,
    display_name: username,
    about: 'aazaad user',
    aazaad_ncryptsec: encryptedNsec,
  }
}

/**
 * Create a local account: generate Nostr keypair, encrypt with password (NIP-49),
 * store in IndexedDB, and publish Kind 0 (including encrypted key backup) to relays
 * so the same username/password works on other devices.
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
  const metadata = buildSignupMetadata(normalized, encryptedNsec)

  await saveLocalAccount({
    username: normalized,
    pubkey: identity.pubkey,
    encryptedNsec,
  })

  await saveProfileRow(metadataToProfileRow(identity.pubkey, metadata))

  // Publish Kind 0 so relays know the display name + portable encrypted key
  try {
    const event = signWithSecretKey(
      buildProfileMetadataEvent({
        username: normalized,
        displayName: normalized,
        about: metadata.about,
        existing: metadata,
      }),
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
 * Best-effort: if this device has the encrypted key but Kind 0 on relays is
 * missing `aazaad_ncryptsec` (e.g. another client overwrote the profile),
 * republish so other devices can log in again.
 */
export async function ensureRemoteAccountBackup(
  account: AccountRow,
  secretKey: Uint8Array,
): Promise<void> {
  try {
    const pool = getPool()
    const filter: Filter = {
      kinds: [0],
      authors: [account.pubkey],
      limit: 1,
    }
    const events = await pool.querySync([...DEFAULT_RELAYS], filter, {
      maxWait: 2500,
    })
    const latest =
      events.length === 0
        ? null
        : events.reduce((a, b) => (a.created_at >= b.created_at ? a : b))
    const existing = parseProfileMetadata(latest)
    if (hasAazaadEncryptedKey(existing)) return

    const event = signWithSecretKey(
      buildProfileMetadataEvent({
        username: account.username,
        displayName: account.username,
        existing: {
          ...existing,
          aazaad_ncryptsec: account.encryptedNsec,
        },
      }),
      secretKey,
    )
    await publishEvent(event)
  } catch {
    // Non-fatal — login already succeeded locally
  }
}

/**
 * Unlock an account with username + password.
 * Tries local IndexedDB first; if missing, restores the NIP-49 backup from
 * Nostr relays (published at signup) and caches it on this device.
 */
export async function loginWithPassword(
  username: string,
  password: string,
): Promise<CreatedAccount> {
  const passwordError = validatePassword(password)
  if (passwordError) throw new Error(passwordError)

  const normalized = normalizeUsername(username)
  const usernameError = validateUsername(normalized)
  if (usernameError) throw new Error(usernameError)

  let account = await getAccountByUsername(normalized)

  if (!account) {
    const remote = await findRemoteAccountBackups(normalized)
    if (remote.length === 0) {
      throw new Error(
        'No account found with that username. Create an account first, or check that you are online.',
      )
    }

    let unlocked: { pubkey: string; encryptedNsec: string; secretKey: Uint8Array } | null =
      null
    let sawDecryptFailure = false

    for (const candidate of remote) {
      try {
        const secretKey = decrypt(candidate.encryptedNsec, password)
        const pubkey = getPublicKey(secretKey).toLowerCase()
        if (pubkey !== candidate.pubkey.toLowerCase()) continue
        unlocked = {
          pubkey,
          encryptedNsec: candidate.encryptedNsec,
          secretKey,
        }
        break
      } catch {
        sawDecryptFailure = true
      }
    }

    if (!unlocked) {
      throw new Error(
        sawDecryptFailure
          ? 'Incorrect password'
          : 'No account found with that username',
      )
    }

    await saveLocalAccount({
      username: normalized,
      pubkey: unlocked.pubkey,
      encryptedNsec: unlocked.encryptedNsec,
    })
    await saveProfileRow(
      metadataToProfileRow(unlocked.pubkey, {
        name: normalized,
        display_name: normalized,
      }),
    )

    return {
      username: normalized,
      pubkey: unlocked.pubkey,
      secretKey: unlocked.secretKey,
    }
  }

  let secretKey: Uint8Array
  try {
    secretKey = decrypt(account.encryptedNsec, password)
  } catch {
    throw new Error('Incorrect password')
  }

  // Heal missing remote backups so other devices can keep logging in
  void ensureRemoteAccountBackup(account, secretKey)

  return {
    username: account.username,
    pubkey: account.pubkey,
    secretKey,
  }
}
