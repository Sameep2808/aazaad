import { useCallback, useEffect, useState } from 'react'
import {
  fetchContactListEvents,
  latestContactList,
  parseContactList,
} from '../lib/nostr'
import { db } from '../lib/db'

export interface UseSocialGraphResult {
  following: string[]
  loading: boolean
  error: string | null
  refreshedAt: number | null
  refresh: () => Promise<void>
}

/**
 * Fetch & cache a user's follow list (Nostr Kind 3 contact list).
 */
export function useSocialGraph(pubkey: string | null | undefined): UseSocialGraphResult {
  const [following, setFollowing] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    if (!pubkey) {
      setFollowing([])
      setRefreshedAt(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      // Serve cache immediately if present
      const cached = await db.follows.get(pubkey)
      if (cached) {
        setFollowing(cached.following)
        setRefreshedAt(cached.updatedAt)
      }

      const events = await fetchContactListEvents(pubkey)
      const latest = latestContactList(events)
      const list = latest ? parseContactList(latest) : []
      const updatedAt = Date.now()

      await db.follows.put({ pubkey, following: list, updatedAt })
      setFollowing(list)
      setRefreshedAt(updatedAt)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load follow list'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { following, loading, error, refreshedAt, refresh }
}
