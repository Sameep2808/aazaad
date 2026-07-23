import { describe, it, expect } from 'vitest'
import {
  extractCid,
  cidToGatewayUrl,
  isImageFile,
  isVideoFile,
  isSupportedMediaFile,
  pickRecorderMimeType,
} from './media'

describe('media helpers', () => {
  it('extracts CIDs from ipfs URIs and gateway paths', () => {
    expect(extractCid('ipfs://bafytest123')).toBe('bafytest123')
    expect(extractCid('https://ipfs.io/ipfs/bafyabc')).toBe('bafyabc')
    expect(extractCid('bafyplaincid')).toBe('bafyplaincid')
    expect(extractCid('no cid here')).toBeNull()
  })

  it('builds gateway URLs', () => {
    expect(cidToGatewayUrl('bafy1')).toBe(
      'https://trustless-gateway.link/ipfs/bafy1',
    )
    expect(cidToGatewayUrl('ipfs://bafy1')).toBe(
      'https://trustless-gateway.link/ipfs/bafy1',
    )
  })

  it('detects image and video files', () => {
    const img = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    const vid = new File(['x'], 'a.mp4', { type: 'video/mp4' })
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' })
    expect(isImageFile(img)).toBe(true)
    expect(isVideoFile(vid)).toBe(true)
    expect(isSupportedMediaFile(img)).toBe(true)
    expect(isSupportedMediaFile(txt)).toBe(false)
  })

  it('pickRecorderMimeType does not throw', () => {
    expect(() => pickRecorderMimeType()).not.toThrow()
  })
})
