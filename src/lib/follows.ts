import { db } from './db'

/** Fired when the local follow list changes (optimistic or from relays). */
export const FOLLOWS_CHANGED_EVENT = 'aazaad:follows-changed'

export function notifyFollowsChanged(ownerPubkey?: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(FOLLOWS_CHANGED_EVENT, {
      detail: { ownerPubkey: ownerPubkey ?? null },
    }),
  )
}

/**
 * Optimistically sync profileStats.following with the viewer's new follow list
 * so Profile PersonLists update without waiting for relays.
 */
export async function syncProfileStatsFollowing(
  ownerPubkey: string,
  following: string[],
): Promise<void> {
  const existing = await db.profileStats.get(ownerPubkey)
  const updatedAt = Date.now()
  await db.profileStats.put({
    pubkey: ownerPubkey,
    following,
    followers: existing?.followers ?? [],
    postCount: existing?.postCount ?? 0,
    updatedAt,
  })
}
