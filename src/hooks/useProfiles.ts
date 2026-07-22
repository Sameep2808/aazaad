import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchAndCacheProfiles,
  type ResolvedProfile,
} from '../lib/profiles'

/**
 * Resolve usernames + profile photos for a set of pubkeys (batch Kind 0).
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

  const [profiles, setProfiles] = useState<Map<string, ResolvedProfile>>(
    () => new Map(),
  )
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (list.length === 0) {
      setProfiles(new Map())
      return
    }
    setLoading(true)
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
    (pubkey: string) => profiles.get(pubkey),
    [profiles],
  )

  return { profiles, loading, refresh, get }
}
