import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ImageIcon, Type } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useHelia } from '../context/HeliaContext'
import { useIPFSUpload } from '../hooks/useIPFSUpload'
import { MediaCapture } from './MediaCapture'
import {
  buildMediaEventTemplate,
  buildTextEventTemplate,
  publishEvent,
} from '../lib/posts'
import { cachePostFromEvent } from '../lib/postCache'
import { isImageFile, isVideoFile } from '../lib/media'
import { getHeliaPeerId, provideCid } from '../lib/ipfs'

type PostMode = 'media' | 'text'
type Stage = 'pick' | 'uploading' | 'compose' | 'publishing' | 'done'

function StorageDisclaimer() {
  return (
    <section className="mt-auto space-y-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3.5 py-3.5 text-[12px] leading-relaxed text-zinc-400">
      <p className="text-[11px] font-semibold tracking-wide text-zinc-300">
        <span className="font-medium text-zinc-200">Welcome to Aazaad: Your Voice, Uncensored and Uncompromised</span>
      </p>
      <p>
        At Aazaad, your words and media stay entirely under your control. There are no central servers, 
        no corporate algorithms, no admina, and no kill switches. You only share what you choose to post, and 
        you own your identity completely. Aazaad is not a traditional platform—it is a decentralized gateway. 
        In fact, anyone can download our open-source code and simply open the index.html file on their 
        local computer to access the network directly. YOU DON'T NEED US TO SPEAK TO THE WORLD.
      </p>
      <p>
        <span className="font-medium text-zinc-200">Text posts</span> are broadcast across the Nostr network, 
        a decentralized system powered by advanced cryptography. Instead of a password, your account is protected 
        by a private key. It uses a global network of independent relays. 
        Because there is no central server, no corporation, or individual can delete your posts or 
        take down your account other than you yourself. Your words are online forever.
      </p>
      <p>
        <span className="font-medium text-zinc-200">Photos &amp; Videos</span>{' '}
        are handled using IPFS (The InterPlanetary File System) and shared person-to-person. Instead of 
        uploading to a corporate server, your device acts as the host. Your media (The one you uploaded) is online only when you are 
        online, or when someone who has seeded your post is online. If you want your media to remain available 
        to the world, simply keep the Aazaad site open in your browser. Because we do not rely on centralized 
        cloud storage, no authority can force us to shut down or delete your media. Search IPFS to learn more about it.
      </p>
      <p className="text-zinc-300">
        Keeping a browser tab open just for media (text stays online even if you close the tab) is a small trade-off 
        for something infinitely bigger: absolute privacy, true digital ownership, and a voice that no one can ever erase.
      </p>
      <p className="text-zinc-300">
        WELCOME TO THE REVOLUTION. YOUR SPEECH IS FREE. YOUR VOICE STAYS.
      </p>
    </section>
  )
}

export function Upload() {
  const { pubkey, signEvent } = useAuth()
  const {
    helia,
    ready: heliaReady,
    error: heliaError,
    waitForMultiaddrs,
  } = useHelia()
  const { upload, uploading, error: uploadError } = useIPFSUpload()

  const [mode, setMode] = useState<PostMode>('media')
  const [stage, setStage] = useState<Stage>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cid, setCid] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [textBody, setTextBody] = useState('')
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
      const nextCid = await upload(selected)
      setCid(nextCid)
      setStage('compose')
      // Prefetch relay/WebRTC addrs while user writes caption
      void waitForMultiaddrs(20_000)
    } catch (err) {
      setStage('pick')
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  async function publishMedia() {
    if (!file || !cid || !pubkey) return
    setError(null)
    setStage('publishing')
    try {
      // Wait for circuit-relay / WebRTC so followers have something to dial
      let providerAddrs: string[] = []
      try {
        providerAddrs = await waitForMultiaddrs(15_000)
      } catch {
        providerAddrs = []
      }

      // Re-announce once dialable (DHT is best-effort; multiaddrs are the P2P path)
      let peerId: string | null = null
      if (helia) {
        peerId = getHeliaPeerId(helia)
        void provideCid(helia, cid)
      }

      const template = buildMediaEventTemplate({
        file,
        cid,
        caption: caption.trim(),
        providerAddrs,
        peerId,
      })
      const signed = await signEvent(template)
      await cachePostFromEvent(signed)
      try {
        await publishEvent(signed)
      } catch (relayErr) {
        console.warn('Relay publish failed; post cached locally', relayErr)
      }
      setPublishedId(signed.id)
      setStage('done')
    } catch (err) {
      setStage('compose')
      setError(err instanceof Error ? err.message : 'Failed to publish to Nostr')
    }
  }

  async function publishText() {
    if (!pubkey) return
    const body = textBody.trim()
    if (!body) {
      setError('Write something before posting')
      return
    }
    setError(null)
    setStage('publishing')
    try {
      const template = buildTextEventTemplate(body)
      const signed = await signEvent(template)
      await cachePostFromEvent(signed)
      try {
        await publishEvent(signed)
      } catch (relayErr) {
        console.warn('Relay publish failed; post cached locally', relayErr)
      }
      setPublishedId(signed.id)
      setStage('done')
    } catch (err) {
      setStage('pick')
      setError(err instanceof Error ? err.message : 'Failed to publish to Nostr')
    }
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setFile(null)
    setCid(null)
    setCaption('')
    setTextBody('')
    setPublishedId(null)
    setError(null)
    setStage('pick')
  }

  function switchMode(next: PostMode) {
    if (next === mode) return
    reset()
    setMode(next)
  }

  if (!pubkey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl font-semibold">New post</h1>
        <p className="text-sm text-zinc-400">
          Create an account or log in to share text, photos, and videos.
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
    <div className="flex flex-1 flex-col gap-5 px-4 py-5 pb-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New post</h1>
        <p className="text-sm text-zinc-400">
          Share a text note, or a photo / video with your community.
        </p>
      </div>

      {stage === 'pick' || (mode === 'text' && stage !== 'done') ? (
        <div className="flex rounded-xl border border-zinc-800 p-1">
          <button
            type="button"
            onClick={() => switchMode('media')}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium',
              mode === 'media'
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-400 active:bg-zinc-900',
            ].join(' ')}
          >
            <ImageIcon className="h-4 w-4" />
            Photo / Video
          </button>
          <button
            type="button"
            onClick={() => switchMode('text')}
            className={[
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-medium',
              mode === 'text'
                ? 'bg-zinc-100 text-zinc-950'
                : 'text-zinc-400 active:bg-zinc-900',
            ].join(' ')}
          >
            <Type className="h-4 w-4" />
            Text
          </button>
        </div>
      ) : null}

      {mode === 'text' && stage !== 'done' && (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-zinc-400">What’s happening?</span>
            <textarea
              value={textBody}
              onChange={(e) => setTextBody(e.target.value)}
              rows={6}
              maxLength={4000}
              placeholder="Write freely — your words stay with you…"
              className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-[15px] leading-relaxed text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-500"
            />
            <span className="block text-right text-[10px] text-zinc-600">
              {textBody.trim().length}/4000
            </span>
          </label>
          <button
            type="button"
            disabled={stage === 'publishing' || !textBody.trim()}
            onClick={() => void publishText()}
            className="w-full rounded-lg bg-white py-3 text-sm font-semibold text-zinc-900 disabled:opacity-50"
          >
            {stage === 'publishing' ? 'Publishing…' : 'Post text'}
          </button>
        </div>
      )}

      {mode === 'media' && stage === 'pick' && (
        <MediaCapture
          disabled={uploading || !heliaReady}
          onMedia={(f) => void handleMedia(f)}
        />
      )}

      {mode === 'media' &&
        (stage === 'uploading' ||
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
                      isImageFile(file)
                        ? 'Write a caption…'
                        : 'Say something about this reel…'
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
                    onClick={() => void publishMedia()}
                    disabled={stage === 'publishing'}
                    className="flex-1 rounded-lg bg-white py-3 text-sm font-semibold text-zinc-900 disabled:opacity-50"
                  >
                    {stage === 'publishing' ? 'Publishing…' : 'Share'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

      {stage === 'done' && (
        <div className="space-y-3 text-center">
          <p className="text-sm text-emerald-400">
            {mode === 'text'
              ? 'Your text is live for everyone to read'
              : 'Shared! Keep the app open so friends can load your photo or video'}
          </p>
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

      {(error || uploadError) && (
        <p className="text-sm text-red-400">{error || uploadError}</p>
      )}

      {mode === 'media' && !heliaReady && (
        <p className="text-xs text-amber-400">
          Getting ready to share media…{heliaError ? ` (${heliaError})` : ''}
        </p>
      )}

      <StorageDisclaimer />
    </div>
  )
}
