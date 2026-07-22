import { describe, it, expect, beforeEach } from 'vitest'
import {
  FEED_PAGE_SIZE,
  RELAY_EVENT_BUDGET_PER_MIN,
  RelayRateLimiter,
  nextUntilCursor,
} from './relayThrottle'
import type { Event } from 'nostr-tools'

describe('relayThrottle', () => {
  let limiter: RelayRateLimiter

  beforeEach(() => {
    limiter = new RelayRateLimiter()
  })

  it('exposes conservative page size under event budget', () => {
    expect(FEED_PAGE_SIZE).toBeLessThanOrEqual(20)
    expect(FEED_PAGE_SIZE * 5).toBeLessThanOrEqual(RELAY_EVENT_BUDGET_PER_MIN)
  })

  it('records and tracks used events in the window', async () => {
    expect(limiter.usedEvents()).toBe(0)
    await limiter.schedule(5, async () => ['a', 'b', 'c'])
    expect(limiter.usedEvents()).toBe(3)
  })

  it('serializes scheduled work', async () => {
    const order: number[] = []
    await Promise.all([
      limiter.schedule(1, async () => {
        order.push(1)
        return 1
      }),
      limiter.schedule(1, async () => {
        order.push(2)
        return 2
      }),
    ])
    expect(order).toEqual([1, 2])
  })

  it('builds next until cursor older than oldest event', () => {
    const events = [
      { created_at: 100 } as Event,
      { created_at: 80 } as Event,
      { created_at: 90 } as Event,
    ]
    expect(nextUntilCursor(events)).toBe(79)
    expect(nextUntilCursor([])).toBeNull()
  })
})
