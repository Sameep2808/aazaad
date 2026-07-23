/** Format Nostr `created_at` (unix seconds) as local date + time. */
export function formatPostDateTime(createdAtSec: number): string {
  return new Date(createdAtSec * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function postDateTimeAttr(createdAtSec: number): string {
  return new Date(createdAtSec * 1000).toISOString()
}
