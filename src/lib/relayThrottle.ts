import type { Event, Filter } from 'nostr-tools'
import { getPool } from './nostr'

/** Conservative mid-range under typical relay caps (10–200 events/min). */
export const RELAY_EVENT_BUDGET_PER_MIN = 100

/** Events requested per page query — keeps responses small & snappy. */
export const FEED_PAGE_SIZE = 12

/** Authors per REQ filter (avoids huge filters + burst responses). */
export const AUTHOR_CHUNK_SIZE = 8

/** Soft cap so engagement queries stay within budget. */
export const ENGAGEMENT_ID_CHUNK = 12
export const ENGAGEMENT_EVENT_LIMIT = 36

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sliding-window limiter for relay traffic.
 * Tracks returned events / minute and spaces outbound queries.
 */
export class RelayRateLimiter {
  private eventLog: { t: number; n: number }[] = []
  private chain: Promise<unknown> = Promise.resolve()

  private prune(now = Date.now()): void {
    const cutoff = now - 60_000
    this.eventLog = this.eventLog.filter((e) => e.t >= cutoff)
  }

  usedEvents(now = Date.now()): number {
    this.prune(now)
    return this.eventLog.reduce((sum, e) => sum + e.n, 0)
  }

  record(n: number, now = Date.now()): void {
    this.eventLog.push({ t: now, n: Math.max(1, n) })
    this.prune(now)
  }

  /**
   * Serialize + budget queries so parallel callers don't stampede relays.
   */
  schedule<T>(estimatedEvents: number, fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const need = Math.max(1, Math.min(estimatedEvents, FEED_PAGE_SIZE * 2))
      // Wait until we have room in the 1-minute window
      for (;;) {
        const used = this.usedEvents()
        if (used + need <= RELAY_EVENT_BUDGET_PER_MIN) break
        const oldest = this.eventLog[0]
        const waitMs = oldest
          ? Math.min(2500, Math.max(80, 60_000 - (Date.now() - oldest.t) + 20))
          : 200
        await sleep(waitMs)
      }
      const result = await fn()
      const counted = Array.isArray(result)
        ? (result as unknown[]).length
        : need
      this.record(Math.max(counted, 1))
      return result
    }

    const next = this.chain.then(run, run)
    // Keep chain alive even if a query fails
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

/** App-wide singleton so Home / Reels / Explore share one budget. */
export const relayLimiter = new RelayRateLimiter()

export async function querySyncThrottled(
  relays: readonly string[],
  filter: Filter,
  opts?: { maxWait?: number },
): Promise<Event[]> {
  const estimate = Math.min(
    typeof filter.limit === 'number' ? filter.limit : FEED_PAGE_SIZE,
    FEED_PAGE_SIZE * 2,
  )
  return relayLimiter.schedule(estimate, () =>
    getPool().querySync([...relays], filter, {
      maxWait: opts?.maxWait ?? 3200,
    }),
  )
}

export function oldestCreatedAt(events: Event[]): number | null {
  if (events.length === 0) return null
  return events.reduce(
    (min, e) => (e.created_at < min ? e.created_at : min),
    events[0]!.created_at,
  )
}

export function nextUntilCursor(events: Event[]): number | null {
  const oldest = oldestCreatedAt(events)
  if (oldest == null) return null
  // Page strictly older than the oldest event we already have
  return oldest - 1
}
