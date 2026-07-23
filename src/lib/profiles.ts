import type { Event, EventTemplate } from 'nostr-tools'
import {
  DEFAULT_RELAYS,
  fetchProfileMetadata,
  getPool,
  parseProfileMetadata,
  type NostrProfileMetadata,
} from './nostr'
import { cidToGatewayUrl, extractCid } from './media'
import { db, type ProfileRow } from './db'
import { getAccountByPubkey } from './accounts'

/** How long a cached profile stays "fresh" before background relay refresh. */
export const PROFILE_CACHE_TTL_MS = 15 * 60 * 1000

export interface ResolvedProfile {
  pubkey: string
  /** @userid style handle when known */
  username: string | null
  displayName: string | null
  /** Best URL for <img src> (gateway or https) */
  pictureUrl: string | null
  pictureCid: string | null
}

interface MemoryProfileEntry {
  profile: ResolvedProfile
  updatedAt: number
}

/** Survives route changes so usernames/avatars don't flash-reload. */
const memoryProfiles = new Map<string, MemoryProfileEntry>()
const profileListeners = new Set<() => void>()

function notifyProfileListeners(): void {
  for (const listener of profileListeners) listener()
}

export function subscribeProfiles(listener: () => void): () => void {
  profileListeners.add(listener)
  return () => {
    profileListeners.delete(listener)
  }
}

/** Synchronous peek — used to paint avatars/handles instantly on navigation. */
export function getMemoryProfile(pubkey: string): ResolvedProfile | undefined {
  return memoryProfiles.get(pubkey)?.profile
}

export function peekProfiles(pubkeys: string[]): Map<string, ResolvedProfile> {
  const map = new Map<string, ResolvedProfile>()
  for (const pk of pubkeys) {
    const entry = memoryProfiles.get(pk)
    if (entry) map.set(pk, entry.profile)
  }
  return map
}

export function isProfileFresh(
  pubkey: string,
  ttlMs: number = PROFILE_CACHE_TTL_MS,
  now = Date.now(),
): boolean {
  const entry = memoryProfiles.get(pubkey)
  if (!entry) return false
  return now - entry.updatedAt < ttlMs
}

export function putMemoryProfile(
  profile: ResolvedProfile,
  updatedAt: number = Date.now(),
): void {
  const prev = memoryProfiles.get(profile.pubkey)
  memoryProfiles.set(profile.pubkey, { profile, updatedAt })
  if (
    !prev ||
    prev.updatedAt !== updatedAt ||
    prev.profile.username !== profile.username ||
    prev.profile.displayName !== profile.displayName ||
    prev.profile.pictureUrl !== profile.pictureUrl ||
    prev.profile.pictureCid !== profile.pictureCid
  ) {
    notifyProfileListeners()
  }
}

/** Test helper — clears the in-memory profile store. */
export function clearMemoryProfiles(): void {
  if (memoryProfiles.size === 0) return
  memoryProfiles.clear()
  notifyProfileListeners()
}

function mergeProfileRow(row: ProfileRow, existing?: ProfileRow | null): ProfileRow {
  if (!existing) return row
  if (!row.username && existing.username) row.username = existing.username
  if (!row.displayName && existing.displayName) {
    row.displayName = existing.displayName
  }
  if (!row.picture && existing.picture) {
    row.picture = existing.picture
    row.pictureCid = existing.pictureCid
  }
  return row
}

export function metadataToProfileRow(
  pubkey: string,
  meta: NostrProfileMetadata,
): ProfileRow {
  const picture = meta.picture?.trim() || null
  const pictureCid = picture ? extractCid(picture) : null
  return {
    pubkey,
    username: meta.name?.trim() || meta.display_name?.trim() || null,
    displayName: meta.display_name?.trim() || meta.name?.trim() || null,
    picture,
    pictureCid,
    updatedAt: Date.now(),
  }
}

export function profileRowToResolved(row: ProfileRow): ResolvedProfile {
  let pictureUrl: string | null = null
  if (row.pictureCid) {
    pictureUrl = cidToGatewayUrl(row.pictureCid)
  } else if (row.picture) {
    pictureUrl = row.picture
  }
  return {
    pubkey: row.pubkey,
    username: row.username,
    displayName: row.displayName,
    pictureUrl,
    pictureCid: row.pictureCid,
  }
}

export async function saveProfileRow(row: ProfileRow): Promise<void> {
  await db.profiles.put(row)
  putMemoryProfile(profileRowToResolved(row), row.updatedAt)
}

export async function getCachedProfile(
  pubkey: string,
): Promise<ResolvedProfile | null> {
  const mem = memoryProfiles.get(pubkey)
  if (mem && isProfileFresh(pubkey)) return mem.profile

  const row = await db.profiles.get(pubkey)
  if (row) {
    const resolved = profileRowToResolved(row)
    putMemoryProfile(resolved, row.updatedAt)
    return resolved
  }

  // Fallback: local password account username
  const account = await getAccountByPubkey(pubkey)
  if (account) {
    const resolved: ResolvedProfile = {
      pubkey,
      username: account.username,
      displayName: account.username,
      pictureUrl: null,
      pictureCid: null,
    }
    putMemoryProfile(resolved, account.createdAt ?? Date.now())
    return resolved
  }

  if (mem) return mem.profile
  return null
}

export async function fetchAndCacheProfile(
  pubkey: string,
  opts?: { force?: boolean },
): Promise<ResolvedProfile> {
  if (!opts?.force) {
    const cached = await getCachedProfile(pubkey)
    if (cached && isProfileFresh(pubkey)) return cached
  }

  const existing = await db.profiles.get(pubkey)
  const meta = await fetchProfileMetadata(pubkey)
  const local = await getAccountByPubkey(pubkey)
  let row = metadataToProfileRow(pubkey, meta)
  row = mergeProfileRow(row, existing)

  if (!row.username && local) {
    row.username = local.username
    row.displayName = row.displayName ?? local.username
  }
  await saveProfileRow(row)
  return profileRowToResolved(row)
}

/** Batch-fetch Kind 0 for many authors and cache them. */
export async function fetchAndCacheProfiles(
  pubkeys: string[],
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 4000,
  opts?: { force?: boolean; ttlMs?: number },
): Promise<Map<string, ResolvedProfile>> {
  const unique = [...new Set(pubkeys.filter(Boolean))]
  const result = new Map<string, ResolvedProfile>()
  if (unique.length === 0) return result

  const ttlMs = opts?.ttlMs ?? PROFILE_CACHE_TTL_MS
  const force = opts?.force ?? false

  // 1) Instant: in-memory (survives navigation)
  for (const pk of unique) {
    const mem = getMemoryProfile(pk)
    if (mem) result.set(pk, mem)
  }

  // 2) IndexedDB for anything not yet in memory
  await Promise.all(
    unique.map(async (pk) => {
      if (result.has(pk) && isProfileFresh(pk, ttlMs)) return
      const cached = await getCachedProfile(pk)
      if (cached) result.set(pk, cached)
    }),
  )

  // 3) Relays only for missing or stale profiles
  const toFetch = unique.filter(
    (pk) => force || !isProfileFresh(pk, ttlMs),
  )

  if (toFetch.length > 0) {
    const chunkSize = 30
    const pool = getPool()
    const relayList = [...relays]

    for (let i = 0; i < toFetch.length; i += chunkSize) {
      const chunk = toFetch.slice(i, i + chunkSize)
      try {
        const events = await pool.querySync(
          relayList,
          { kinds: [0], authors: chunk, limit: chunk.length },
          { maxWait },
        )
        const latestByAuthor = new Map<string, Event>()
        for (const event of events) {
          const prev = latestByAuthor.get(event.pubkey)
          if (!prev || event.created_at >= prev.created_at) {
            latestByAuthor.set(event.pubkey, event)
          }
        }
        for (const [pubkey, event] of latestByAuthor) {
          const meta = parseProfileMetadata(event)
          const local = await getAccountByPubkey(pubkey)
          const existing = await db.profiles.get(pubkey)
          let row = metadataToProfileRow(pubkey, meta)
          row = mergeProfileRow(row, existing)
          if (!row.username && local) {
            row.username = local.username
            row.displayName = row.displayName ?? local.username
          }
          await saveProfileRow(row)
          result.set(pubkey, profileRowToResolved(row))
        }

        // Mark pubkeys with no Kind 0 as "checked" so we don't re-hit relays
        // every navigation within the TTL window.
        const now = Date.now()
        for (const pk of chunk) {
          if (latestByAuthor.has(pk)) continue
          const existing = result.get(pk)
          if (existing) {
            putMemoryProfile(existing, now)
            const row = await db.profiles.get(pk)
            if (row) await db.profiles.update(pk, { updatedAt: now })
          } else {
            const stub: ResolvedProfile = {
              pubkey: pk,
              username: null,
              displayName: null,
              pictureUrl: null,
              pictureCid: null,
            }
            putMemoryProfile(stub, now)
            result.set(pk, stub)
          }
        }
      } catch {
        // keep cached entries
      }
    }
  }

  // Ensure every pubkey has at least a stub
  for (const pk of unique) {
    if (!result.has(pk)) {
      const stub: ResolvedProfile = {
        pubkey: pk,
        username: null,
        displayName: null,
        pictureUrl: null,
        pictureCid: null,
      }
      result.set(pk, stub)
    }
  }

  return result
}

export function buildProfileMetadataEvent(opts: {
  username?: string | null
  displayName?: string | null
  about?: string | null
  pictureCid?: string | null
  existing?: NostrProfileMetadata
}): EventTemplate {
  const metadata: NostrProfileMetadata = {
    ...opts.existing,
    name: opts.username ?? opts.existing?.name,
    display_name:
      opts.displayName ?? opts.username ?? opts.existing?.display_name,
    about: opts.about ?? opts.existing?.about ?? 'aazaad user',
  }

  // Keep cross-device password backup when another client field is updated
  if (opts.existing?.aazaad_ncryptsec) {
    metadata.aazaad_ncryptsec = opts.existing.aazaad_ncryptsec
  }

  if (opts.pictureCid) {
    // HTTP gateway URL so browsers / Nostr clients can load the avatar
    metadata.picture = cidToGatewayUrl(opts.pictureCid)
  } else if (opts.existing?.picture) {
    metadata.picture = opts.existing.picture
  }

  return {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['client', 'aazaad']],
    content: JSON.stringify(metadata),
  }
}

export function displayHandle(profile: ResolvedProfile | null | undefined): string {
  if (profile?.username) return `@${profile.username}`
  if (profile?.displayName) return profile.displayName
  if (profile?.pubkey) return `${profile.pubkey.slice(0, 8)}…`
  return 'user'
}

export function initialsFromProfile(
  profile: ResolvedProfile | null | undefined,
): string {
  const base = profile?.username ?? profile?.displayName ?? profile?.pubkey ?? 'aa'
  return base.slice(0, 2).toUpperCase()
}
