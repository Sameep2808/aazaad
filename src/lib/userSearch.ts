import {
  DEFAULT_RELAYS,
  decodePubkey,
  getPool,
  hexToNpub,
  parseProfileMetadata,
  type Filter,
} from './nostr'
import { db } from './db'
import { listAccounts, normalizeUsername } from './accounts'
import {
  fetchAndCacheProfile,
  getCachedProfile,
  metadataToProfileRow,
  profileRowToResolved,
  saveProfileRow,
  type ResolvedProfile,
} from './profiles'

export type UserQueryKind = 'empty' | 'pubkey' | 'username'

export interface ParsedUserQuery {
  kind: UserQueryKind
  /** Normalized username (no @) or hex pubkey */
  value: string
  /** Original trimmed input */
  raw: string
}

export function parseUserQuery(input: string): ParsedUserQuery {
  const raw = input.trim()
  if (!raw) return { kind: 'empty', value: '', raw }

  const asPubkey = decodePubkey(raw)
  if (asPubkey) return { kind: 'pubkey', value: asPubkey, raw }

  const username = normalizeUsername(raw.replace(/^@+/, ''))
  if (!username) return { kind: 'empty', value: '', raw }
  return { kind: 'username', value: username, raw }
}

function scoreUsernameMatch(username: string | null, query: string): number {
  if (!username) return 0
  const u = username.toLowerCase()
  if (u === query) return 100
  if (u.startsWith(query)) return 80
  if (u.includes(query)) return 40
  return 0
}

async function searchLocalByUsername(
  query: string,
): Promise<Map<string, ResolvedProfile>> {
  const found = new Map<string, ResolvedProfile>()

  const accounts = await listAccounts()
  for (const acc of accounts) {
    if (scoreUsernameMatch(acc.username, query) > 0) {
      const cached = await getCachedProfile(acc.pubkey)
      found.set(
        acc.pubkey,
        cached ?? {
          pubkey: acc.pubkey,
          username: acc.username,
          displayName: acc.username,
          pictureUrl: null,
          pictureCid: null,
        },
      )
    }
  }

  const profiles = await db.profiles.toArray()
  for (const row of profiles) {
    const score = Math.max(
      scoreUsernameMatch(row.username, query),
      scoreUsernameMatch(row.displayName, query),
    )
    if (score <= 0) continue
    if (!found.has(row.pubkey)) {
      found.set(row.pubkey, profileRowToResolved(row))
    }
  }

  return found
}

/** Best-effort NIP-50 text search for Kind 0 profiles on supporting relays. */
async function searchRelaysByUsername(
  query: string,
  relays: readonly string[] = DEFAULT_RELAYS,
  maxWait = 3500,
): Promise<ResolvedProfile[]> {
  const pool = getPool()
  const filter: Filter = {
    kinds: [0],
    search: query,
    limit: 30,
  }
  try {
    const events = await pool.querySync([...relays], filter, { maxWait })
    const latestByAuthor = new Map<string, (typeof events)[0]>()
    for (const event of events) {
      const prev = latestByAuthor.get(event.pubkey)
      if (!prev || event.created_at >= prev.created_at) {
        latestByAuthor.set(event.pubkey, event)
      }
    }

    const results: ResolvedProfile[] = []
    for (const [pubkey, event] of latestByAuthor) {
      const meta = parseProfileMetadata(event)
      const name = (meta.name ?? meta.display_name ?? '').toLowerCase()
      if (query.length >= 2 && name && !name.includes(query)) {
        // Some relays ignore search — keep soft matches only when name hits
        continue
      }
      const row = metadataToProfileRow(pubkey, meta)
      await saveProfileRow(row)
      results.push(profileRowToResolved(row))
    }
    return results
  } catch {
    return []
  }
}

/**
 * Search users by @userid / username, npub, nprofile, or hex pubkey.
 */
export async function searchUsers(
  input: string,
  opts?: { limit?: number },
): Promise<ResolvedProfile[]> {
  const limit = opts?.limit ?? 25
  const parsed = parseUserQuery(input)
  if (parsed.kind === 'empty') return []

  if (parsed.kind === 'pubkey') {
    const profile = await fetchAndCacheProfile(parsed.value)
    return [profile]
  }

  const local = await searchLocalByUsername(parsed.value)
  const relayHits = await searchRelaysByUsername(parsed.value)
  for (const hit of relayHits) {
    if (!local.has(hit.pubkey)) local.set(hit.pubkey, hit)
  }

  const ranked = [...local.values()].sort((a, b) => {
    const sa = scoreUsernameMatch(a.username ?? a.displayName, parsed.value)
    const sb = scoreUsernameMatch(b.username ?? b.displayName, parsed.value)
    if (sb !== sa) return sb - sa
    return (a.username ?? '').localeCompare(b.username ?? '')
  })

  return ranked.slice(0, limit)
}

export function profilePath(pubkeyOrNpub: string): string {
  const hex = decodePubkey(pubkeyOrNpub) ?? pubkeyOrNpub
  try {
    return `/u/${hexToNpub(hex)}`
  } catch {
    return `/u/${hex}`
  }
}
