import { useCallback, useEffect, useRef, useState } from 'react'
import { searchUsers } from '../lib/userSearch'
import type { ResolvedProfile } from '../lib/profiles'

export function useUserSearch(debounceMs = 280) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ResolvedProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const reqId = useRef(0)

  const run = useCallback(async (q: string) => {
    const id = ++reqId.current
    const trimmed = q.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      setError(null)
      setSearched(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const found = await searchUsers(trimmed)
      if (id !== reqId.current) return
      setResults(found)
      setSearched(true)
    } catch (err) {
      if (id !== reqId.current) return
      setError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
      setSearched(true)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void run(query)
    }, debounceMs)
    return () => window.clearTimeout(handle)
  }, [query, debounceMs, run])

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    searched,
    searchNow: () => void run(query),
  }
}
