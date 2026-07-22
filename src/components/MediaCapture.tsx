import { useRef, useState } from 'react'
import {
  Camera,
  FlipHorizontal2,
  Image as ImageIcon,
  Circle,
  Square,
  Video,
  X,
} from 'lucide-react'
import { useCamera } from '../hooks/useCamera'
import { isSupportedMediaFile } from '../lib/media'

interface MediaCaptureProps {
  disabled?: boolean
  onMedia: (file: File) => void
}

/**
 * Cross-platform capture:
 * - Gallery picker (photos & videos) via file input — works on iOS/Android/desktop
 * - Native camera fallbacks via capture= attributes (iPhone/Android)
 * - Live getUserMedia preview for photo + MediaRecorder video (desktop & modern mobile)
 */
export function MediaCapture({ disabled, onMedia }: MediaCaptureProps) {
  const galleryRef = useRef<HTMLInputElement>(null)
  const nativePhotoRef = useRef<HTMLInputElement>(null)
  const nativeVideoRef = useRef<HTMLInputElement>(null)
  const camera = useCamera()
  const [hint, setHint] = useState<string | null>(null)

  function acceptFile(file: File | undefined | null) {
    if (!file) return
    if (!isSupportedMediaFile(file)) {
      setHint('Please choose a photo or video')
      return
    }
    setHint(null)
    onMedia(file)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    acceptFile(file)
  }

  async function openLive(mode: 'photo' | 'video') {
    setHint(null)
    try {
      await camera.start(mode)
    } catch {
      // Fallback to native capture inputs when getUserMedia fails (common on some WebViews)
      if (mode === 'photo') nativePhotoRef.current?.click()
      else nativeVideoRef.current?.click()
    }
  }

  async function onShutter() {
    try {
      if (camera.mode === 'photo') {
        const file = await camera.takePhoto()
        camera.stop()
        onMedia(file)
      } else if (camera.mode === 'video') {
        if (!camera.recording) {
          if (!camera.recorderSupported) {
            camera.stop()
            nativeVideoRef.current?.click()
            return
          }
          camera.startRecording()
        } else {
          const file = await camera.stopRecording()
          camera.stop()
          onMedia(file)
        }
      }
    } catch (err) {
      setHint(err instanceof Error ? err.message : 'Capture failed')
    }
  }

  return (
    <div className="space-y-4">
      {/* Hidden inputs — maximum mobile compatibility */}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,video/*,image/heic,image/heif,.mp4,.mov,.webm"
        className="hidden"
        onChange={onInputChange}
      />
      <input
        ref={nativePhotoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onInputChange}
      />
      <input
        ref={nativeVideoRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={onInputChange}
      />

      {camera.active ? (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video
            ref={camera.videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-[3/4] w-full object-cover"
          />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
            <button
              type="button"
              onClick={() => camera.stop()}
              className="rounded-full bg-black/50 p-2 text-white"
              aria-label="Close camera"
            >
              <X className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void camera.flipCamera()}
              className="rounded-full bg-black/50 p-2 text-white"
              aria-label="Flip camera"
            >
              <FlipHorizontal2 className="h-5 w-5" />
            </button>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
            <p className="text-xs text-white/80">
              {camera.mode === 'video'
                ? camera.recording
                  ? 'Recording… tap stop when done'
                  : 'Tap to start recording'
                : 'Tap to capture photo'}
            </p>
            <button
              type="button"
              onClick={() => void onShutter()}
              className={[
                'flex h-16 w-16 items-center justify-center rounded-full border-4 border-white',
                camera.recording ? 'bg-red-500' : 'bg-white/20',
              ].join(' ')}
              aria-label={camera.recording ? 'Stop recording' : 'Capture'}
            >
              {camera.mode === 'video' ? (
                camera.recording ? (
                  <Square className="h-6 w-6 fill-white text-white" />
                ) : (
                  <Circle className="h-10 w-10 fill-red-500 text-red-500" />
                )
              ) : (
                <Circle className="h-12 w-12 fill-white text-white" />
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => galleryRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-2 py-4 text-xs text-zinc-200 disabled:opacity-40"
          >
            <ImageIcon className="h-6 w-6" />
            Gallery
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void openLive('photo')}
            className="flex flex-col items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-2 py-4 text-xs text-zinc-200 disabled:opacity-40"
          >
            <Camera className="h-6 w-6" />
            Photo
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void openLive('video')}
            className="flex flex-col items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-2 py-4 text-xs text-zinc-200 disabled:opacity-40"
          >
            <Video className="h-6 w-6" />
            Record
          </button>
        </div>
      )}

      {!camera.active && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => nativePhotoRef.current?.click()}
            className="flex-1 rounded-lg border border-zinc-800 py-2 text-[11px] text-zinc-400"
          >
            System camera (photo)
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => nativeVideoRef.current?.click()}
            className="flex-1 rounded-lg border border-zinc-800 py-2 text-[11px] text-zinc-400"
          >
            System camera (video)
          </button>
        </div>
      )}

      {(hint || camera.error) && (
        <p className="text-sm text-amber-400">{hint || camera.error}</p>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Gallery works on iPhone, Android, and laptops. Live camera needs HTTPS and
        permission — if blocked, use System camera buttons.
      </p>
    </div>
  )
}
