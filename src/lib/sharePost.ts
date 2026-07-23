import { hexToNpub } from './nostr'
import { displayHandle, type ResolvedProfile } from './profiles'
import type { FeedPost } from './posts'
import { profilePath } from './userSearch'

/** In-app deep link for a Nostr event / post. */
export function postPath(eventId: string): string {
  return `/p/${eventId.toLowerCase()}`
}

export function formatSharedPostDm(
  post: FeedPost,
  authorProfile?: ResolvedProfile | null,
  note?: string,
): string {
  const handle = displayHandle(
    authorProfile ?? {
      pubkey: post.pubkey,
      username: null,
      displayName: null,
      pictureUrl: null,
      pictureCid: null,
    },
  )
  const caption = post.caption.trim().slice(0, 120)
  const lines = [
    'Shared a post on aazaad',
    `From ${handle}`,
  ]
  if (caption) lines.push(caption)
  lines.push(`Open: ${postPath(post.id)}`)
  lines.push(`Author: ${profilePath(post.pubkey)}`)

  const extra = note?.trim()
  if (extra) {
    return `${extra}\n\n${lines.join('\n')}`
  }
  return lines.join('\n')
}

export function absolutePostUrl(eventId: string): string {
  if (typeof window === 'undefined') return postPath(eventId)
  return `${window.location.origin}${postPath(eventId)}`
}

/** Best-effort npub for display (invalid hex → hex slice). */
export function authorNpubOrHex(pubkey: string): string {
  try {
    return hexToNpub(pubkey)
  } catch {
    return pubkey.slice(0, 16)
  }
}
