import { useCallback, useState } from 'react'
import { useHelia } from '../context/HeliaContext'
import { seedCid } from '../lib/ipfs'
import { db } from '../lib/db'

export interface UseIPFSSeedResult {
  seed: (cid: string) => Promise<void>
  seeding: boolean
  error: string | null
  isSeeded: (cid: string) => Promise<boolean>
}

/**
 * Pin/download a CID into the local Helia blockstore (IndexedDB)
 * so this browser actively seeds the file to the network.
 */
export function useIPFSSeed(): UseIPFSSeedResult {
  const { helia, ready } = useHelia()
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seed = useCallback(
    async (cid: string): Promise<void> => {
      if (!helia || !ready) {
        throw new Error('Helia node is not ready')
      }
      setSeeding(true)
      setError(null)
      try {
        await seedCid(helia, cid)
        await db.seeds.put({ cid, pinnedAt: Date.now() })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Seeding failed'
        setError(message)
        throw err
      } finally {
        setSeeding(false)
      }
    },
    [helia, ready],
  )

  const isSeeded = useCallback(async (cid: string): Promise<boolean> => {
    const row = await db.seeds.get(cid)
    return Boolean(row)
  }, [])

  return { seed, seeding, error, isSeeded }
}
