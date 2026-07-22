import { describe, it, expect } from 'vitest'
import {
  buildProfileMetadataEvent,
  displayHandle,
  metadataToProfileRow,
  profileRowToResolved,
} from './profiles'
import { extractCid } from './media'

describe('profiles', () => {
  it('extracts picture CID and builds resolved profile', () => {
    const row = metadataToProfileRow('a'.repeat(64), {
      name: 'alice',
      display_name: 'Alice',
      picture: 'https://ipfs.io/ipfs/bafypic123',
    })
    expect(row.username).toBe('alice')
    expect(row.pictureCid).toBe('bafypic123')
    const resolved = profileRowToResolved(row)
    expect(resolved.pictureUrl).toContain('bafypic123')
    expect(displayHandle(resolved)).toBe('@alice')
  })

  it('builds Kind 0 metadata with picture gateway URL', () => {
    const event = buildProfileMetadataEvent({
      username: 'bob',
      pictureCid: 'bafyavatar',
    })
    expect(event.kind).toBe(0)
    const content = JSON.parse(event.content) as { name: string; picture: string }
    expect(content.name).toBe('bob')
    expect(extractCid(content.picture)).toBe('bafyavatar')
  })
})
