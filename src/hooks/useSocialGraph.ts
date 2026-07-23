import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchContactListEvents,
  latestContactList,
  parseContactList,
} from '../lib/nostr'
import { db } from '../lib/db'
import { FOLLOWS_CHANGED_EVENT } from '../lib/follows'

export interface UseSocialGraphResult {
  following: string[]
  loading: boolean
  error: string | null
  refreshedAt: number | null
  refresh: () => Promise<void>
}

/**
 * Fetch & cache a user's follow list (Nostr Kind 3 contact list).
 * Paints Dexie cache first, then refreshes from relays.
 */
export function useSocialGraph(pubkey: string | null | undefined): UseSocialGraphResult {
  const [following, setFollowing] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)
  const pubkeyRef = useRef(pubkey)
  pubkeyRef.current = pubkey

  const applyCache = useCallback(async (pk: string) => {
    const cached = await db.follows.get(pk)
    if (cached) {
      setFollowing(cached.following)
      setRefreshedAt(cached.updatedAt)
      return true
    }
    return false
  }, [])

  const refresh = useCallback(async () => {
    if (!pubkey) {
      setFollowing([])
      setRefreshedAt(null)
      return
    }

    setError(null)
    const hadCache = await applyCache(pubkey)
    if (!hadCache) setLoading(true)

    try {
      const events = await fetchContactListEvents(pubkey)
      const latest = latestContactList(events)
      const list = latest ? parseContactList(latest) : []
      const updatedAt = Date.now()

      await db.follows.put({ pubkey, following: list, updatedAt })
      if (pubkeyRef.current === pubkey) {
        setFollowing(list)
        setRefreshedAt(updatedAt)
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load follow list'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [pubkey, applyCache])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Instant UI update when follow/unfollow happens elsewhere
  useEffect(() => {
    if (!pubkey) return
    const pk = pubkey
    function onFollowsChanged(event: Event) {
      const custom = event as CustomEvent<{ ownerPubkey: string | null }>
      if (custom.detail?.ownerPubkey && custom.detail.ownerPubkey !== pk) {
        return
      }
      void applyCache(pk)
    }
    window.addEventListener(FOLLOWS_CHANGED_EVENT, onFollowsChanged)
    return () => window.removeEventListener(FOLLOWS_CHANGED_EVENT, onFollowsChanged)
  }, [pubkey, applyCache])

  // Refresh when tab becomes visible again
  useEffect(() => {
    if (!pubkey) return
    function onVisibility() {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [pubkey, refresh])

  return { following, loading, error, refreshedAt, refresh }
}
