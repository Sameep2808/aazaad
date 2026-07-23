import { useCallback, useState } from 'react'
import { useHelia } from '../context/HeliaContext'
import { uploadFileToIPFS } from '../lib/ipfs'
import { db } from '../lib/db'

export interface UseIPFSUploadResult {
  upload: (file: File) => Promise<string>
  uploading: boolean
  error: string | null
  lastCid: string | null
  progress: 'idle' | 'reading' | 'adding' | 'done' | 'error'
}

/**
 * Upload a File through Helia UnixFS and return the CID string.
 * Pins + announces the CID so other peers can discover this seeder.
 */
export function useIPFSUpload(): UseIPFSUploadResult {
  const { helia, ready } = useHelia()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastCid, setLastCid] = useState<string | null>(null)
  const [progress, setProgress] = useState<UseIPFSUploadResult['progress']>('idle')

  const upload = useCallback(
    async (file: File): Promise<string> => {
      if (!helia || !ready) {
        throw new Error('Helia node is not ready')
      }
      setUploading(true)
      setError(null)
      setProgress('reading')
      try {
        setProgress('adding')
        const cid = await uploadFileToIPFS(helia, file)
        // Track as a seed so boot re-provide covers own uploads
        await db.seeds.put({ cid, pinnedAt: Date.now() })
        setLastCid(cid)
        setProgress('done')
        return cid
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        setError(message)
        setProgress('error')
        throw err
      } finally {
        setUploading(false)
      }
    },
    [helia, ready],
  )

  return { upload, uploading, error, lastCid, progress }
}
