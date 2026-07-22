import { createHelia, type Helia, type HeliaInit } from 'helia'
import { unixfs, type UnixFS } from '@helia/unixfs'
import { IDBBlockstore } from 'blockstore-idb'
import { IDBDatastore } from 'datastore-idb'
import { CID } from 'multiformats/cid'

export type HeliaNode = Helia & { fs: UnixFS }

export interface CreateHeliaNodeOptions {
  /** Override stores (useful for tests). Defaults to IndexedDB in browser. */
  blockstore?: HeliaInit['blockstore']
  datastore?: HeliaInit['datastore']
  /** IndexedDB name prefix when using default browser stores */
  idbName?: string
}

function canUseIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * Create an in-browser Helia node with IndexedDB-backed block/datastore
 * so uploaded & seeded content survives reloads.
 */
export async function createHeliaNode(
  options: CreateHeliaNodeOptions = {},
): Promise<HeliaNode> {
  const idbName = options.idbName ?? 'aazaad'

  let blockstore = options.blockstore
  let datastore = options.datastore

  if (!blockstore || !datastore) {
    if (canUseIndexedDB()) {
      const idbBlockstore = new IDBBlockstore(`${idbName}-blocks`)
      const idbDatastore = new IDBDatastore(`${idbName}-data`)
      await idbBlockstore.open()
      await idbDatastore.open()
      blockstore = blockstore ?? idbBlockstore
      datastore = datastore ?? idbDatastore
    }
  }

  const helia = await createHelia({
    ...(blockstore ? { blockstore } : {}),
    ...(datastore ? { datastore } : {}),
  })

  const fs = unixfs(helia)
  return Object.assign(helia, { fs })
}

/** Add a File to UnixFS and return its CID string. */
export async function uploadFileToIPFS(
  node: HeliaNode,
  file: File | Blob,
): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const cid = await node.fs.addBytes(bytes, {
    rawLeaves: true,
  })

  // Pin so the blockstore retains the content (idempotent)
  if (!(await node.pins.isPinned(cid))) {
    for await (const _ of node.pins.add(cid)) {
      // drain pin DAG walk
    }
  }

  return cid.toString()
}

/**
 * Fetch & pin a CID into the local Helia blockstore (IndexedDB),
 * actively seeding the content to the network.
 */
export async function seedCid(node: HeliaNode, cidString: string): Promise<void> {
  const cid = CID.parse(cidString)

  // Download all chunks into the local blockstore
  for await (const _chunk of node.fs.cat(cid)) {
    // drain stream — side effect is local persistence via blockstore
  }

  // Explicitly pin so GC won't drop it (idempotent if already pinned)
  const alreadyPinned = await node.pins.isPinned(cid)
  if (!alreadyPinned) {
    for await (const _ of node.pins.add(cid)) {
      // drain
    }
  }
}

/**
 * Stop intentionally seeding a CID by unpinning it from the local Helia node.
 */
export async function unseedCid(
  node: HeliaNode,
  cidString: string,
): Promise<void> {
  const cid = CID.parse(cidString)
  if (!(await node.pins.isPinned(cid))) return
  for await (const _ of node.pins.rm(cid)) {
    // drain unpin walk
  }
}

export function parseCid(cidString: string): CID {
  return CID.parse(cidString)
}

/** Load a CID from the local Helia node into a blob object URL for <img>/<video>. */
export async function loadCidAsObjectUrl(
  node: HeliaNode,
  cidString: string,
  mimeType?: string | null,
): Promise<string> {
  const cid = CID.parse(cidString)
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of node.fs.cat(cid)) {
    chunks.push(chunk)
    total += chunk.length
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  const type = mimeType || 'application/octet-stream'
  const blob = new Blob([bytes], { type })
  return URL.createObjectURL(blob)
}
