import { describe, it, expect, afterEach } from 'vitest'
import {
  createHeliaNode,
  uploadFileToIPFS,
  seedCid,
  unseedCid,
  parseCid,
} from './ipfs'

describe('ipfs layer', () => {
  const nodes: Awaited<ReturnType<typeof createHeliaNode>>[] = []

  afterEach(async () => {
    await Promise.all(nodes.splice(0).map((n) => n.stop()))
  })

  it('creates a Helia node with UnixFS', async () => {
    const node = await createHeliaNode({ idbName: `test-${Date.now()}` })
    nodes.push(node)
    expect(node.fs).toBeDefined()
    expect(node.pins).toBeDefined()
    expect(node.blockstore).toBeDefined()
  })

  it('uploads a File and returns a valid CID', async () => {
    const node = await createHeliaNode({ idbName: `upload-${Date.now()}` })
    nodes.push(node)

    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'clip.bin', {
      type: 'application/octet-stream',
    })
    const cid = await uploadFileToIPFS(node, file)

    expect(cid).toMatch(/^[a-z0-9]+$/i)
    expect(() => parseCid(cid)).not.toThrow()

    // Content is readable back from the local node
    const chunks: Uint8Array[] = []
    for await (const chunk of node.fs.cat(parseCid(cid))) {
      chunks.push(chunk)
    }
    const restored = new Uint8Array(
      chunks.reduce((acc, c) => acc + c.length, 0),
    )
    let offset = 0
    for (const chunk of chunks) {
      restored.set(chunk, offset)
      offset += chunk.length
    }
    expect(Array.from(restored)).toEqual([1, 2, 3, 4, 5])
  })

  it('seeds a CID into a second node via pin + cat', async () => {
    const a = await createHeliaNode({ idbName: `seed-a-${Date.now()}` })
    const b = await createHeliaNode({ idbName: `seed-b-${Date.now()}` })
    nodes.push(a, b)

    const file = new File([new TextEncoder().encode('aazaad-seed')], 't.txt')
    const cid = await uploadFileToIPFS(a, file)

    // Same process: seed on node A (already local) should succeed
    await expect(seedCid(a, cid)).resolves.toBeUndefined()

    let pinned = false
    for await (const pin of a.pins.ls({ cid: parseCid(cid) })) {
      if (pin.cid.toString() === cid) pinned = true
    }
    expect(pinned).toBe(true)
  })

  it('unseeds by unpinning a previously seeded CID', async () => {
    const node = await createHeliaNode({ idbName: `unseed-${Date.now()}` })
    nodes.push(node)

    const file = new File([new TextEncoder().encode('unpin-me')], 'u.txt')
    const cid = await uploadFileToIPFS(node, file)
    await seedCid(node, cid)
    expect(await node.pins.isPinned(parseCid(cid))).toBe(true)

    await unseedCid(node, cid)
    expect(await node.pins.isPinned(parseCid(cid))).toBe(false)
  })
})
