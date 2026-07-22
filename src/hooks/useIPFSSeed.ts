import { useCallback, useEffect, useState } from 'react'
import { useHelia } from '../context/HeliaContext'
import { seedCid, unseedCid } from '../lib/ipfs'
import { db } from '../lib/db'

export interface UseIPFSSeedResult {
  /** Start seeding (idempotent). */
  seed: (cid: string) => Promise<void>
  /** Stop seeding / unpin. */
  unseed: (cid: string) => Promise<void>
  /** Toggle seed on/off for a CID. */
  toggleSeed: (cid: string) => Promise<'seeded' | 'unseeded'>
  busyCid: string | null
  /** True while any seed op is in flight */
  seeding: boolean
  error: string | null
  isSeeded: (cid: string) => boolean
  /** Sync UI from Dexie (e.g. after auto-seed on repost) */
  hydrate: (cids: string[]) => Promise<void>
  /** Optimistically mark a CID as seeding (e.g. after repost auto-seed) */
  noteSeeded: (cid: string) => void
  clearError: () => void
}

/**
 * Pin/unpin CIDs in the local Helia blockstore so this browser
 * can toggle seeding a post on or off.
 */
export function useIPFSSeed(): UseIPFSSeedResult {
  const { helia, ready } = useHelia()
  const [busyCid, setBusyCid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeCids, setActiveCids] = useState<Set<string>>(() => new Set())

  const mark = useCallback((cid: string, on: boolean) => {
    setActiveCids((prev) => {
      const next = new Set(prev)
      if (on) next.add(cid)
      else next.delete(cid)
      return next
    })
  }, [])

  const hydrate = useCallback(async (cids: string[]) => {
    const unique = [...new Set(cids.filter(Boolean))]
    if (unique.length === 0) return
    const found: string[] = []
    const missing: string[] = []
    await Promise.all(
      unique.map(async (cid) => {
        const row = await db.seeds.get(cid)
        if (row) found.push(cid)
        else missing.push(cid)
      }),
    )
    setActiveCids((prev) => {
      const next = new Set(prev)
      for (const cid of found) next.add(cid)
      for (const cid of missing) next.delete(cid)
      return next
    })
  }, [])

  useEffect(() => {
    void db.seeds.toArray().then((rows) => {
      if (rows.length === 0) return
      setActiveCids(new Set(rows.map((r) => r.cid)))
    })
  }, [])

  const seed = useCallback(
    async (cid: string): Promise<void> => {
      if (!helia || !ready) {
        throw new Error('Helia node is not ready')
      }
      setBusyCid(cid)
      setError(null)
      try {
        await seedCid(helia, cid)
        await db.seeds.put({ cid, pinnedAt: Date.now() })
        mark(cid, true)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Seeding failed'
        setError(message)
        throw err
      } finally {
        setBusyCid(null)
      }
    },
    [helia, ready, mark],
  )

  const unseed = useCallback(
    async (cid: string): Promise<void> => {
      if (!helia || !ready) {
        throw new Error('Helia node is not ready')
      }
      setBusyCid(cid)
      setError(null)
      try {
        await unseedCid(helia, cid)
        await db.seeds.delete(cid)
        mark(cid, false)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unseed failed'
        setError(message)
        throw err
      } finally {
        setBusyCid(null)
      }
    },
    [helia, ready, mark],
  )

  const toggleSeed = useCallback(
    async (cid: string): Promise<'seeded' | 'unseeded'> => {
      if (!helia || !ready) {
        throw new Error('Helia node is not ready')
      }
      if (busyCid === cid) {
        return activeCids.has(cid) ? 'seeded' : 'unseeded'
      }

      const currently =
        activeCids.has(cid) || Boolean(await db.seeds.get(cid))

      if (currently) {
        await unseed(cid)
        return 'unseeded'
      }
      await seed(cid)
      return 'seeded'
    },
    [helia, ready, busyCid, activeCids, seed, unseed],
  )

  return {
    seed,
    unseed,
    toggleSeed,
    busyCid,
    seeding: busyCid !== null,
    error,
    isSeeded: (cid: string) => activeCids.has(cid),
    hydrate,
    noteSeeded: (cid: string) => mark(cid, true),
    clearError: () => setError(null),
  }
}
