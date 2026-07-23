import { db } from './db'
import { blockPeer, unblockPeer } from './dm'
import type { FeedPost } from './posts'

/** Fired whenever the local block list changes (DM + feed). */
export const BLOCKS_CHANGED_EVENT = 'aazaad:blocks-changed'

export function notifyBlocksChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(BLOCKS_CHANGED_EVENT))
}

export async function listBlockedPubkeys(
  ownerPubkey: string,
): Promise<string[]> {
  const rows = await db.dmBlocks
    .where('ownerPubkey')
    .equals(ownerPubkey)
    .toArray()
  return [...new Set(rows.map((r) => r.peerPubkey.toLowerCase()))]
}

export async function getBlockedSet(
  ownerPubkey: string | null | undefined,
): Promise<Set<string>> {
  if (!ownerPubkey) return new Set()
  return new Set(await listBlockedPubkeys(ownerPubkey))
}

/**
 * Hide posts authored by blocked users, and reposts made by blocked users.
 * Original content in a repost from someone else is still shown if the
 * original author is not blocked.
 */
export function filterOutBlockedAuthors<
  T extends { pubkey: string; repost?: { pubkey: string } },
>(posts: T[], blocked: ReadonlySet<string>): T[] {
  if (blocked.size === 0) return posts
  return posts.filter((post) => {
    if (blocked.has(post.pubkey.toLowerCase())) return false
    if (post.repost && blocked.has(post.repost.pubkey.toLowerCase())) {
      return false
    }
    return true
  })
}

export function excludeBlockedPubkeys(
  pubkeys: string[],
  blocked: ReadonlySet<string>,
): string[] {
  if (blocked.size === 0) return pubkeys
  return pubkeys.filter((pk) => !blocked.has(pk.toLowerCase()))
}

/** Block for DMs + feeds; dm layer notifies listeners so Home/Explore/Reels refresh. */
export async function blockUser(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<void> {
  await blockPeer(ownerPubkey, peerPubkey)
}

export async function unblockUser(
  ownerPubkey: string,
  peerPubkey: string,
): Promise<void> {
  await unblockPeer(ownerPubkey, peerPubkey)
}

export function filterFeedPosts(
  posts: FeedPost[],
  blocked: ReadonlySet<string>,
): FeedPost[] {
  return filterOutBlockedAuthors(posts, blocked)
}
