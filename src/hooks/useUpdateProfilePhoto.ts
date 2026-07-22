import { useCallback, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useHelia } from '../context/HeliaContext'
import { useIPFSUpload } from './useIPFSUpload'
import {
  buildProfileMetadataEvent,
  fetchAndCacheProfile,
  metadataToProfileRow,
  saveProfileRow,
  type ResolvedProfile,
} from '../lib/profiles'
import { fetchProfileMetadata, publishEvent } from '../lib/nostr'
import { isImageFile } from '../lib/media'

export function useUpdateProfilePhoto() {
  const { pubkey, username, signEvent } = useAuth()
  const { ready: heliaReady } = useHelia()
  const { upload, uploading } = useIPFSUpload()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ResolvedProfile | null>(null)

  const load = useCallback(async () => {
    if (!pubkey) {
      setProfile(null)
      return null
    }
    const resolved = await fetchAndCacheProfile(pubkey)
    setProfile(resolved)
    return resolved
  }, [pubkey])

  const updatePhoto = useCallback(
    async (file: File): Promise<ResolvedProfile> => {
      if (!pubkey) throw new Error('Log in to set a profile photo')
      if (!heliaReady) throw new Error('IPFS node is still starting')
      if (!isImageFile(file)) throw new Error('Please choose an image file')

      setBusy(true)
      setError(null)
      try {
        const cid = await upload(file)
        const existing = await fetchProfileMetadata(pubkey)
        const template = buildProfileMetadataEvent({
          username,
          displayName: username,
          pictureCid: cid,
          existing,
        })
        const signed = await signEvent(template)
        const row = metadataToProfileRow(
          pubkey,
          JSON.parse(signed.content) as {
            name?: string
            display_name?: string
            picture?: string
          },
        )
        // Ensure CID is stored even if picture is gateway URL
        row.pictureCid = cid
        row.username = row.username ?? username
        await saveProfileRow(row)

        void publishEvent(signed)

        const resolved = await fetchAndCacheProfile(pubkey)
        // Prefer just-uploaded CID immediately
        const next: ResolvedProfile = {
          ...resolved,
          pictureCid: cid,
          pictureUrl: resolved.pictureUrl,
          username: resolved.username ?? username,
        }
        setProfile(next)
        return next
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update profile photo'
        setError(message)
        throw err
      } finally {
        setBusy(false)
      }
    },
    [pubkey, username, heliaReady, upload, signEvent],
  )

  return {
    profile,
    load,
    updatePhoto,
    busy: busy || uploading,
    error,
  }
}
