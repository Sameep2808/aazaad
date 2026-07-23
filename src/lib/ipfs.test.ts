import { describe, it, expect, afterEach } from 'vitest'
import {
  createHeliaNode,
  uploadFileToIPFS,
  seedCid,
  unseedCid,
  parseCid,
  provideCid,
  loadCidAsObjectUrl,
} from './ipfs'

/** Local-only Helia — skip libp2p start (happy-dom hangs on WebRTC bootstrap). */
async function createLocalNode(prefix: string) {
  return createHeliaNode({ idbName: `${prefix}-${Date.now()}`, start: false })
}

describe('ipfs layer', () => {
  const nodes: Awaited<ReturnType<typeof createHeliaNode>>[] = []

  afterEach(async () => {
    await Promise.all(
      nodes.splice(0).map(async (n) => {
        if (n.status === 'started') await n.stop()
      }),
    )
  })

  it('creates a Helia node with UnixFS', async () => {
    const node = await createLocalNode('test')
    nodes.push(node)
    expect(node.fs).toBeDefined()
    expect(node.pins).toBeDefined()
    expect(node.blockstore).toBeDefined()
    expect(node.routing).toBeDefined()
  })

  it('starts libp2p when start is left at default', async () => {
    const node = await createHeliaNode({
      idbName: `started-${Date.now()}`,
    })
    nodes.push(node)
    expect(node.status).toBe('started')
    // libp2p is only available after start()
    expect(node.libp2p).toBeDefined()
  }, 30_000)

  it('uploads a File and returns a valid CID', async () => {
    const node = await createLocalNode('upload')
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

  it('loads local CID as object URL without hanging', async () => {
    const node = await createLocalNode('load')
    nodes.push(node)
    const file = new File([new TextEncoder().encode('hello-aazaad')], 't.txt', {
      type: 'text/plain',
    })
    const cid = await uploadFileToIPFS(node, file)
    const url = await loadCidAsObjectUrl(node, cid, {
      mimeType: 'text/plain',
      timeoutMs: 5_000,
    })
    expect(url).toMatch(/^blob:/)
    URL.revokeObjectURL(url)
  })

  it('provideCid does not throw for a local pin', async () => {
    const node = await createLocalNode('provide')
    nodes.push(node)
    const file = new File([new TextEncoder().encode('provide-me')], 'p.txt')
    const cid = await uploadFileToIPFS(node, file)
    await expect(provideCid(node, cid)).resolves.toBeUndefined()
  })

  it('seeds a CID into a second node via pin + cat', async () => {
    const a = await createLocalNode('seed-a')
    const b = await createLocalNode('seed-b')
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
    const node = await createLocalNode('unseed')
    nodes.push(node)

    const file = new File([new TextEncoder().encode('unpin-me')], 'u.txt')
    const cid = await uploadFileToIPFS(node, file)
    await seedCid(node, cid)
    expect(await node.pins.isPinned(parseCid(cid))).toBe(true)

    await unseedCid(node, cid)
    expect(await node.pins.isPinned(parseCid(cid))).toBe(false)
  })
})
