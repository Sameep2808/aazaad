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

export interface ResolvedProfile {
  pubkey: string
  /** @userid style handle when known */
  username: string | null
  displayName: string | null
  /** Best URL for <img src> (gateway or https) */
  pictureUrl: string | null
  pictureCid: string | null
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
}

export async function getCachedProfile(
  pubkey: string,
): Promise<ResolvedProfile | null> {
  const row = await db.profiles.get(pubkey)
  if (row) return profileRowToResolved(row)

  // Fallback: local password account username
  const account = await getAccountByPubkey(pubkey)
  if (account) {
    return {
      pubkey,
      username: account.username,
      displayName: account.username,
      pictureUrl: null,
      pictureCid: null,
    }
  }
  return null
}

export async function fetchAndCacheProfile(
  pubkey: string,
): Promise<ResolvedProfile> {
  const existing = await db.profiles.get(pubkey)
  const meta = await fetchProfileMetadata(pubkey)
  const local = await getAccountByPubkey(pubkey)
  const row = metadataToProfileRow(pubkey, meta)

  // Keep richer local/cache fields when relays return sparse Kind 0
  if (!row.username && existing?.username) {
    row.username = existing.username
  }
  if (!row.displayName && existing?.displayName) {
    row.displayName = existing.displayName
  }
  if (!row.picture && existing?.picture) {
    row.picture = existing.picture
    row.pictureCid = existing.pictureCid
  }

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
): Promise<Map<string, ResolvedProfile>> {
  const unique = [...new Set(pubkeys.filter(Boolean))]
  const result = new Map<string, ResolvedProfile>()
  if (unique.length === 0) return result

  // Seed from cache / local accounts first
  await Promise.all(
    unique.map(async (pk) => {
      const cached = await getCachedProfile(pk)
      if (cached) result.set(pk, cached)
    }),
  )

  const missingOrStale = unique
  const chunkSize = 30
  const pool = getPool()
  const relayList = [...relays]

  for (let i = 0; i < missingOrStale.length; i += chunkSize) {
    const chunk = missingOrStale.slice(i, i + chunkSize)
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
        const row = metadataToProfileRow(pubkey, meta)
        if (!row.username && local) {
          row.username = local.username
          row.displayName = row.displayName ?? local.username
        }
        await saveProfileRow(row)
        result.set(pubkey, profileRowToResolved(row))
      }
    } catch {
      // keep cached entries
    }
  }

  // Ensure every pubkey has at least a stub
  for (const pk of unique) {
    if (!result.has(pk)) {
      result.set(pk, {
        pubkey: pk,
        username: null,
        displayName: null,
        pictureUrl: null,
        pictureCid: null,
      })
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
