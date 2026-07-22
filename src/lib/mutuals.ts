import {
  deriveFollowersFromKind3,
  fetchFollowerCandidateEvents,
  DEFAULT_RELAYS,
} from './nostr'
import type { FeedPost } from './posts'

/**
 * Pubkeys you follow who also follow you back (mutuals).
 */
export async function getMutualPubkeys(
  viewerPubkey: string,
  following: string[],
  opts?: { maxWait?: number },
): Promise<string[]> {
  const uniqueFollowing = [...new Set(following.filter(Boolean))]
  if (!viewerPubkey || uniqueFollowing.length === 0) return []

  try {
    const events = await fetchFollowerCandidateEvents(
      viewerPubkey,
      DEFAULT_RELAYS,
      opts?.maxWait ?? 4000,
    )
    const followers = new Set(
      deriveFollowersFromKind3(viewerPubkey, events),
    )
    return uniqueFollowing.filter((pk) => followers.has(pk))
  } catch {
    return []
  }
}

function byNewest(a: FeedPost, b: FeedPost): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}

/**
 * Mutual-follow authors first (newest within group), then everyone else.
 */
export function prioritizeMutualAuthors(
  posts: FeedPost[],
  mutualPubkeys: Iterable<string>,
  withinGroupSort: (a: FeedPost, b: FeedPost) => number = byNewest,
): FeedPost[] {
  const mutual = new Set(
    [...mutualPubkeys].map((pk) => pk.toLowerCase()),
  )
  const first: FeedPost[] = []
  const rest: FeedPost[] = []
  for (const post of posts) {
    if (mutual.has(post.pubkey.toLowerCase())) first.push(post)
    else rest.push(post)
  }
  first.sort(withinGroupSort)
  rest.sort(withinGroupSort)
  return [...first, ...rest]
}
