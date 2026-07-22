import {
  DEFAULT_RELAYS,
  deriveFollowersFromKind3,
  fetchFollowerCandidateEvents,
} from './nostr'

export interface DiscoverFollowersOptions {
  /** How many of your follows to sample for their followers */
  maxSeeds?: number
  /** Cap on discovered author pubkeys */
  maxAuthors?: number
  maxWaitPerSeed?: number
}

/**
 * People who follow accounts that `viewer` follows (2-hop inbound discovery).
 * Excludes the viewer and anyone already in `following`.
 */
export async function discoverFollowersOfFollowing(
  viewerPubkey: string,
  following: string[],
  opts: DiscoverFollowersOptions = {},
): Promise<string[]> {
  const maxSeeds = opts.maxSeeds ?? 12
  const maxAuthors = opts.maxAuthors ?? 48
  const maxWait = opts.maxWaitPerSeed ?? 2800

  const seeds = [...new Set(following.filter(Boolean))].slice(0, maxSeeds)
  if (seeds.length === 0) return []

  const exclude = new Set<string>([viewerPubkey, ...following])
  const discovered = new Set<string>()

  // Parallel per-seed follower lookups (bounded by maxSeeds)
  const batches = await Promise.all(
    seeds.map((seed) =>
      fetchFollowerCandidateEvents(seed, DEFAULT_RELAYS, maxWait).catch(
        () => [] as Awaited<ReturnType<typeof fetchFollowerCandidateEvents>>,
      ),
    ),
  )

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]!
    const followers = deriveFollowersFromKind3(seed, batches[i] ?? [])
    for (const pubkey of followers) {
      if (exclude.has(pubkey)) continue
      discovered.add(pubkey)
      if (discovered.size >= maxAuthors) {
        return [...discovered]
      }
    }
  }

  return [...discovered]
}
