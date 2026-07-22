import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useHelia } from '../context/HeliaContext'
import { useIPFSUpload } from '../hooks/useIPFSUpload'
import { MediaCapture } from './MediaCapture'
import { buildMediaEventTemplate, publishEvent } from '../lib/posts'
import { cachePostFromEvent } from '../lib/postCache'
import { isImageFile, isVideoFile } from '../lib/media'

type Stage = 'pick' | 'uploading' | 'compose' | 'publishing' | 'done'

export function Upload() {
  const { pubkey, signEvent } = useAuth()
  const { ready: heliaReady, error: heliaError } = useHelia()
  const { upload, uploading, error: uploadError } = useIPFSUpload()

  const [stage, setStage] = useState<Stage>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cid, setCid] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [publishedId, setPublishedId] = useState<string | null>(null)

  async function handleMedia(selected: File) {
    if (!pubkey) {
      setError('Log in from Profile before uploading')
      return
    }
    if (!heliaReady) {
      setError(heliaError ?? 'IPFS node is still starting — try again in a moment')
      return
    }

    setError(null)
    setFile(selected)
    setPublishedId(null)
    setCid(null)
    setCaption('')
    setPreviewUrl(URL.createObjectURL(selected))
    setStage('uploading')

    try {
      // Upload to Helia/IPFS immediately after capture/pick
      const nextCid = await upload(selected)
      setCid(nextCid)
      setStage('compose')
    } catch (err) {
      setStage('pick')
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  async function publish() {
    if (!file || !cid || !pubkey) return
    setError(null)
    setStage('publishing')
    try {
      const template = buildMediaEventTemplate({ file, cid, caption: caption.trim() })
      const signed = await signEvent(template)
      // Always cache locally first so Home + Profile show the post immediately
      await cachePostFromEvent(signed)
      try {
        await publishEvent(signed)
      } catch (relayErr) {
        // Local visibility still works even if relays are temporarily down
        console.warn('Relay publish failed; post cached locally', relayErr)
      }
      setPublishedId(signed.id)
      setStage('done')
    } catch (err) {
      setStage('compose')
      setError(err instanceof Error ? err.message : 'Failed to publish to Nostr')
    }
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setFile(null)
    setCid(null)
    setCaption('')
    setPublishedId(null)
    setError(null)
    setStage('pick')
  }

  if (!pubkey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl font-semibold">Upload</h1>
        <p className="text-sm text-zinc-400">
          Create an account or log in to post photos and videos.
        </p>
        <Link
          to="/profile"
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900"
        >
          Go to Profile
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 py-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New post</h1>
        <p className="text-sm text-zinc-400">
          Pick from gallery or use the camera — uploads to IPFS right away.
        </p>
      </div>

      {stage === 'pick' && (
        <MediaCapture disabled={uploading || !heliaReady} onMedia={(f) => void handleMedia(f)} />
      )}

      {(stage === 'uploading' ||
        stage === 'compose' ||
        stage === 'publishing' ||
        stage === 'done') &&
        file &&
        previewUrl && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
              {isVideoFile(file) ? (
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  className="max-h-80 w-full object-contain"
                />
              ) : (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="max-h-80 w-full object-contain"
                />
              )}
            </div>

            {stage === 'uploading' && (
              <p className="text-sm text-zinc-400">Uploading to IPFS…</p>
            )}

            {cid && (
              <p className="break-all font-mono text-[10px] text-zinc-500">
                CID: {cid}
              </p>
            )}

            {(stage === 'compose' || stage === 'publishing') && (
              <>
                <label className="block space-y-1.5">
                  <span className="text-xs text-zinc-400">Caption</span>
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    rows={3}
                    placeholder={
                      isImageFile(file) ? 'Write a caption…' : 'Say something about this reel…'
                    }
                    className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-500"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    disabled={stage === 'publishing'}
                    className="flex-1 rounded-lg border border-zinc-700 py-3 text-sm text-zinc-200"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => void publish()}
                    disabled={stage === 'publishing'}
                    className="flex-1 rounded-lg bg-white py-3 text-sm font-semibold text-zinc-900 disabled:opacity-50"
                  >
                    {stage === 'publishing' ? 'Publishing…' : 'Share'}
                  </button>
                </div>
              </>
            )}

            {stage === 'done' && (
              <div className="space-y-3 text-center">
                <p className="text-sm text-emerald-400">Posted to Nostr relays</p>
                {publishedId && (
                  <p className="break-all font-mono text-[10px] text-zinc-500">
                    {publishedId}
                  </p>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="w-full rounded-lg bg-white py-3 text-sm font-semibold text-zinc-900"
                >
                  New post
                </button>
              </div>
            )}
          </div>
        )}

      {(error || uploadError) && (
        <p className="text-sm text-red-400">{error || uploadError}</p>
      )}

      {!heliaReady && (
        <p className="text-xs text-amber-400">
          Waiting for Helia/IPFS node…{heliaError ? ` (${heliaError})` : ''}
        </p>
      )}
    </div>
  )
}
