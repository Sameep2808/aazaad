/**
 * Cross-platform media helpers for gallery picks, live camera,
 * still capture, and video recording (iOS / Android / desktop).
 */

export type FacingMode = 'user' | 'environment'

export function isSecureMediaContext(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.isSecureContext ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  )
}

export function canUseGetUserMedia(): boolean {
  return (
    isSecureMediaContext() &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

export function canUseMediaRecorder(): boolean {
  return typeof MediaRecorder !== 'undefined'
}

/** Prefer MP4 on Safari/iOS; WebM elsewhere. */
export function pickRecorderMimeType(): string | undefined {
  if (!canUseMediaRecorder()) return undefined
  const candidates = [
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

export async function openCameraStream(
  facing: FacingMode = 'environment',
  withAudio = true,
): Promise<MediaStream> {
  if (!canUseGetUserMedia()) {
    throw new Error(
      'Camera access requires HTTPS (or localhost) and a supported browser',
    )
  }

  const videoConstraints: MediaTrackConstraints = {
    facingMode: { ideal: facing },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: withAudio,
      video: videoConstraints,
    })
  } catch {
    // Fallback: simpler constraints for older iOS / Android WebViews
    return navigator.mediaDevices.getUserMedia({
      audio: withAudio,
      video: true,
    })
  }
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop())
}

/** Capture a still JPEG from a live <video> element. */
export async function capturePhotoFromVideo(
  video: HTMLVideoElement,
  filename = `aazaad-${Date.now()}.jpg`,
): Promise<File> {
  const width = video.videoWidth || 1280
  const height = video.videoHeight || 720
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(video, 0, 0, width, height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to capture photo'))),
      'image/jpeg',
      0.92,
    )
  })

  return new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() })
}

export function extensionForMime(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('quicktime')) return 'mov'
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.startsWith('image/')) return 'img'
  if (mime.startsWith('video/')) return 'mp4'
  return 'bin'
}

export function blobToFile(blob: Blob, basename: string): File {
  const mime = blob.type || 'application/octet-stream'
  const ext = extensionForMime(mime)
  const name = basename.includes('.') ? basename : `${basename}.${ext}`
  return new File([blob], name, { type: mime, lastModified: Date.now() })
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic)$/i.test(file.name)
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name)
}

export function isSupportedMediaFile(file: File): boolean {
  return isImageFile(file) || isVideoFile(file)
}

/** Build a gateway URL for a CID (HTTP fallback while Helia resolves). */
export const IPFS_GATEWAYS = [
  'https://trustless-gateway.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://w3s.link/ipfs/',
  'https://4everland.io/ipfs/',
] as const

export function cidToGatewayUrl(cid: string, gateway: string = IPFS_GATEWAYS[0]): string {
  const cleaned = cid.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '')
  return `${gateway}${cleaned}`
}

/** Extract an IPFS CID from content or imeta tags. */
export function extractCid(text: string): string | null {
  const ipfsUri = text.match(/ipfs:\/\/([a-zA-Z0-9]+)/)
  if (ipfsUri) return ipfsUri[1]
  const path = text.match(/\/ipfs\/([a-zA-Z0-9]+)/)
  if (path) return path[1]
  if (/^(bafy|bafk|Qm)[a-zA-Z0-9]+$/.test(text.trim())) return text.trim()
  return null
}
