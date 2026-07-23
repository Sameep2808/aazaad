import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchAndCacheProfiles,
  isProfileFresh,
  peekProfiles,
  subscribeProfiles,
  type ResolvedProfile,
} from '../lib/profiles'

/**
 * Resolve usernames + profile photos for a set of pubkeys.
 * Uses a shared in-memory cache (backed by IndexedDB) so navigating
 * between pages does not re-fetch or flash-reload known profiles.
 */
export function useProfiles(pubkeys: string[]): {
  profiles: Map<string, ResolvedProfile>
  loading: boolean
  refresh: () => Promise<void>
  get: (pubkey: string) => ResolvedProfile | undefined
} {
  const key = useMemo(
    () => [...new Set(pubkeys.filter(Boolean))].sort().join(','),
    [pubkeys],
  )
  const list = useMemo(() => (key ? key.split(',') : []), [key])

  const [profiles, setProfiles] = useState<Map<string, ResolvedProfile>>(() =>
    peekProfiles(list),
  )
  const [loading, setLoading] = useState(
    () => list.length > 0 && list.some((pk) => !isProfileFresh(pk)),
  )

  // Keep React state in sync when another screen updates a profile
  useEffect(() => {
    setProfiles(peekProfiles(list))
    return subscribeProfiles(() => {
      setProfiles(peekProfiles(list))
    })
  }, [list])

  const refresh = useCallback(async () => {
    if (list.length === 0) {
      setProfiles(new Map())
      setLoading(false)
      return
    }
    // Paint anything we already know before network/IDB work
    setProfiles(peekProfiles(list))
    const needsFetch = list.some((pk) => !isProfileFresh(pk))
    if (needsFetch) setLoading(true)
    try {
      const map = await fetchAndCacheProfiles(list)
      setProfiles(map)
    } finally {
      setLoading(false)
    }
  }, [list])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const get = useCallback(
    (pubkey: string) => profiles.get(pubkey) ?? peekProfiles([pubkey]).get(pubkey),
    [profiles],
  )

  return { profiles, loading, refresh, get }
}
