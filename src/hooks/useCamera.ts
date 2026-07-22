import { useCallback, useEffect, useRef, useState } from 'react'
import {
  canUseGetUserMedia,
  canUseMediaRecorder,
  capturePhotoFromVideo,
  openCameraStream,
  pickRecorderMimeType,
  stopMediaStream,
  blobToFile,
  type FacingMode,
} from '../lib/media'

export type CameraMode = 'idle' | 'photo' | 'video'

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>
  stream: MediaStream | null
  active: boolean
  mode: CameraMode
  facing: FacingMode
  recording: boolean
  error: string | null
  supported: boolean
  recorderSupported: boolean
  start: (mode: CameraMode, facing?: FacingMode) => Promise<void>
  stop: () => void
  flipCamera: () => Promise<void>
  takePhoto: () => Promise<File>
  startRecording: () => void
  stopRecording: () => Promise<File>
}

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null!)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [active, setActive] = useState(false)
  const [mode, setMode] = useState<CameraMode>('idle')
  const [facing, setFacing] = useState<FacingMode>('environment')
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const attachStream = useCallback(async (next: MediaStream) => {
    stopMediaStream(streamRef.current)
    streamRef.current = next
    setStream(next)
    const el = videoRef.current
    if (el) {
      el.srcObject = next
      el.muted = true
      el.playsInline = true
      try {
        await el.play()
      } catch {
        // Autoplay may require another tap on some iOS versions; UI still shows frame
      }
    }
  }, [])

  const start = useCallback(
    async (nextMode: CameraMode, nextFacing: FacingMode = facing) => {
      setError(null)
      if (nextMode === 'idle') return
      try {
        const withAudio = nextMode === 'video'
        const media = await openCameraStream(nextFacing, withAudio)
        setFacing(nextFacing)
        setMode(nextMode)
        setActive(true)
        await attachStream(media)
      } catch (err) {
        setActive(false)
        setMode('idle')
        setError(
          err instanceof Error
            ? err.message
            : 'Camera permission denied or unavailable',
        )
        throw err
      }
    },
    [attachStream, facing],
  )

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch {
        // ignore
      }
    }
    recorderRef.current = null
    chunksRef.current = []
    stopMediaStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStream(null)
    setActive(false)
    setRecording(false)
    setMode('idle')
  }, [])

  useEffect(() => () => stop(), [stop])

  const flipCamera = useCallback(async () => {
    const next: FacingMode = facing === 'environment' ? 'user' : 'environment'
    if (!active || mode === 'idle') {
      setFacing(next)
      return
    }
    await start(mode, next)
  }, [active, facing, mode, start])

  const takePhoto = useCallback(async () => {
    const el = videoRef.current
    if (!el) throw new Error('Camera preview not ready')
    return capturePhotoFromVideo(el)
  }, [])

  const startRecording = useCallback(() => {
    const media = streamRef.current
    if (!media) throw new Error('Camera not active')
    if (!canUseMediaRecorder()) {
      throw new Error('Video recording is not supported in this browser')
    }
    const mime = pickRecorderMimeType()
    const recorder = mime
      ? new MediaRecorder(media, { mimeType: mime })
      : new MediaRecorder(media)
    chunksRef.current = []
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data)
    }
    recorder.start(250)
    recorderRef.current = recorder
    setRecording(true)
  }, [])

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) throw new Error('Not recording')

    const file = await new Promise<File>((resolve, reject) => {
      recorder.onstop = () => {
        const mime = recorder.mimeType || pickRecorderMimeType() || 'video/webm'
        const blob = new Blob(chunksRef.current, { type: mime })
        chunksRef.current = []
        recorderRef.current = null
        setRecording(false)
        if (blob.size === 0) {
          reject(new Error('Recording was empty'))
          return
        }
        resolve(blobToFile(blob, `aazaad-${Date.now()}`))
      }
      recorder.onerror = () => reject(new Error('Recording failed'))
      try {
        recorder.stop()
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to stop recording'))
      }
    })

    return file
  }, [])

  return {
    videoRef,
    stream,
    active,
    mode,
    facing,
    recording,
    error,
    supported: canUseGetUserMedia(),
    recorderSupported: canUseMediaRecorder(),
    start,
    stop,
    flipCamera,
    takePhoto,
    startRecording,
    stopRecording,
  }
}
