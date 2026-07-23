import { createHelia, type Helia, type HeliaInit } from 'helia'
import { unixfs, type UnixFS } from '@helia/unixfs'
import { IDBBlockstore } from 'blockstore-idb'
import { IDBDatastore } from 'datastore-idb'
import { CID } from 'multiformats/cid'
import { multiaddr, type Multiaddr } from '@multiformats/multiaddr'
import { IPFS_GATEWAYS, cidToGatewayUrl } from './media'

/** Helia with UnixFS; browser createHelia also attaches libp2p after start(). */
export type HeliaNode = Helia & {
  fs: UnixFS
  libp2p?: {
    dial: (ma: Multiaddr) => Promise<unknown>
    getMultiaddrs: () => Multiaddr[]
    peerId: { toString: () => string }
  }
}

export interface CreateHeliaNodeOptions {
  /** Override stores (useful for tests). Defaults to IndexedDB in browser. */
  blockstore?: HeliaInit['blockstore']
  datastore?: HeliaInit['datastore']
  /** IndexedDB name prefix when using default browser stores */
  idbName?: string
  /**
   * Start libp2p/bitswap after create (default true).
   * Set false in unit tests that only need local add/cat — happy-dom
   * cannot complete browser WebRTC bootstrap and will hang.
   */
  start?: boolean
}

export interface LoadCidOptions {
  mimeType?: string | null
  /** Dial these peers first (from Nostr multiaddr tags). */
  providerAddrs?: string[]
  /** Abort Helia / gateway race after this many ms. */
  timeoutMs?: number
}

const DEFAULT_LOAD_TIMEOUT_MS = 45_000
const PROVIDE_TIMEOUT_MS = 25_000
const DIAL_TIMEOUT_MS = 12_000

function canUseIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isHeliaStarted(node: Helia): boolean {
  return node.status === 'started'
}

function parseProviderMultiaddrs(addrs: string[]): Multiaddr[] {
  const out: Multiaddr[] = []
  for (const addr of addrs) {
    if (!addr) continue
    try {
      out.push(multiaddr(addr))
    } catch {
      // skip malformed
    }
  }
  return out
}

/**
 * Create an in-browser Helia node with IndexedDB-backed block/datastore
 * so uploaded & seeded content survives reloads.
 *
 * Helia 7 returns an unstarted node — libp2p is only attached after
 * `await helia.start()`. Without that, any `node.libp2p` access throws
 * NotStartedError ("Not started").
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

  const helia = createHelia({
    ...(blockstore ? { blockstore } : {}),
    ...(datastore ? { datastore } : {}),
  })

  // Core: start libp2p + bitswap + routing before any network / libp2p use.
  // Without this, accessing helia.libp2p throws NotStartedError ("Not started").
  if (options.start !== false) {
    await helia.start()
  }

  const fs = unixfs(helia)
  return Object.assign(helia, { fs }) as HeliaNode
}

/** Dialable multiaddrs for this browser peer (circuit / webrtc preferred). */
export function getPeerMultiaddrs(node: HeliaNode): string[] {
  if (!isHeliaStarted(node)) return []
  try {
    const addrs = node.libp2p?.getMultiaddrs() ?? []
    const strings = addrs.map((a) => a.toString())
    // Prefer relayed / WebRTC addrs — browsers usually cannot dial bare LAN IPs.
    const preferred = strings.filter(
      (a) => a.includes('p2p-circuit') || a.includes('/webrtc'),
    )
    return preferred.length > 0 ? preferred : strings
  } catch {
    // libp2p getter throws NotStartedError if start() never completed
    return []
  }
}

/** Libp2p peer id string for this Helia node (empty if not started). */
export function getHeliaPeerId(node: HeliaNode): string | null {
  if (!isHeliaStarted(node)) return null
  try {
    return node.libp2p?.peerId.toString() ?? null
  } catch {
    return null
  }
}

/**
 * Wait briefly for circuit-relay / WebRTC listen addrs so followers can dial us.
 */
export async function waitForDialableAddrs(
  node: HeliaNode,
  timeoutMs = 12_000,
): Promise<string[]> {
  if (!isHeliaStarted(node)) return []
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const addrs = getPeerMultiaddrs(node)
    if (
      addrs.some(
        (a) => a.includes('p2p-circuit') || a.includes('/webrtc'),
      )
    ) {
      return addrs
    }
    await sleep(400)
  }
  return getPeerMultiaddrs(node)
}

/** Best-effort dial of provider multiaddrs before bitswap. */
export async function dialProviderAddrs(
  node: HeliaNode,
  addrs: string[],
  timeoutMs = DIAL_TIMEOUT_MS,
): Promise<void> {
  if (!isHeliaStarted(node) || addrs.length === 0) return
  let libp2p: HeliaNode['libp2p']
  try {
    libp2p = node.libp2p
  } catch {
    return
  }
  if (!libp2p) return

  const signal = AbortSignal.timeout(timeoutMs)
  await Promise.allSettled(
    addrs.slice(0, 8).map(async (addr) => {
      if (signal.aborted) return
      try {
        await libp2p!.dial(multiaddr(addr))
      } catch {
        // Peer offline / undialable — bitswap + gateways still tried
      }
    }),
  )
}

/**
 * Announce that this node provides the CID (DHT / content routing).
 * Helia does NOT do this automatically after add/pin.
 */
export async function provideCid(
  node: HeliaNode,
  cidString: string,
): Promise<void> {
  if (!isHeliaStarted(node)) return
  const cid = CID.parse(cidString)
  try {
    await node.routing.provide(cid, {
      signal: AbortSignal.timeout(PROVIDE_TIMEOUT_MS),
    })
  } catch {
    // Providing can fail transiently (no peers yet); caller may retry later
  }
}

/** Re-announce every local pin so peers can find content after reload. */
export async function reprovideLocalPins(node: HeliaNode): Promise<number> {
  let n = 0
  for await (const pin of node.pins.ls()) {
    try {
      await node.routing.provide(pin.cid, {
        signal: AbortSignal.timeout(PROVIDE_TIMEOUT_MS),
      })
      n += 1
    } catch {
      // keep going
    }
  }
  return n
}

/** Add a File to UnixFS, pin it, announce on the network, return CID string. */
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

  // Announce in background — never block the upload/publish UI on DHT
  void provideCid(node, cid.toString())

  return cid.toString()
}

/**
 * Fetch & pin a CID into the local Helia blockstore (IndexedDB),
 * then announce so this peer becomes another seeder.
 */
export async function seedCid(node: HeliaNode, cidString: string): Promise<void> {
  const cid = CID.parse(cidString)

  // Download all chunks into the local blockstore
  for await (const _chunk of node.fs.cat(cid, {
    signal: AbortSignal.timeout(DEFAULT_LOAD_TIMEOUT_MS * 2),
  })) {
    // drain stream — side effect is local persistence via blockstore
  }

  // Explicitly pin so GC won't drop it (idempotent if already pinned)
  const alreadyPinned = await node.pins.isPinned(cid)
  if (!alreadyPinned) {
    for await (const _ of node.pins.add(cid)) {
      // drain
    }
  }

  // Background announce — seeding UX shouldn't wait on DHT
  void provideCid(node, cidString)
}

/**
 * Stop intentionally seeding a CID by unpinning it from the local Helia node.
 */
export async function unseedCid(
  node: HeliaNode,
  cidString: string,
): Promise<void> {
  const cid = CID.parse(cidString)
  try {
    await node.routing.cancelReprovide(cid)
  } catch {
    // ignore
  }
  if (!(await node.pins.isPinned(cid))) return
  for await (const _ of node.pins.rm(cid)) {
    // drain unpin walk
  }
}

export function parseCid(cidString: string): CID {
  return CID.parse(cidString)
}

async function concatUnixFs(
  node: HeliaNode,
  cid: CID,
  signal: AbortSignal,
  providerAddrs: string[] = [],
): Promise<Uint8Array> {
  const providers = parseProviderMultiaddrs(providerAddrs)
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of node.fs.cat(cid, {
    signal,
    // Tell bitswap exactly who has the blocks — bypass flaky DHT findProviders
    ...(providers.length > 0 ? { providers } : {}),
  })) {
    chunks.push(chunk)
    total += chunk.length
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** Parallel HTTP gateway fetch — useful when content is already on public IPFS. */
export async function fetchCidBytesFromGateways(
  cidString: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const cleaned = cidString.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '')
  const errors: unknown[] = []

  const attempt = async (gateway: string): Promise<Uint8Array> => {
    const url = cidToGatewayUrl(cleaned, gateway)
    const res = await fetch(url, { signal, mode: 'cors' })
    if (!res.ok) throw new Error(`Gateway ${gateway} returned ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }

  // Race all gateways; first success wins
  return await new Promise<Uint8Array>((resolve, reject) => {
    let pending = IPFS_GATEWAYS.length
    let settled = false
    for (const gateway of IPFS_GATEWAYS) {
      void attempt(gateway)
        .then((bytes) => {
          if (settled) return
          settled = true
          resolve(bytes)
        })
        .catch((err) => {
          errors.push(err)
          pending -= 1
          if (pending === 0 && !settled) {
            reject(errors[0] ?? new Error('All IPFS gateways failed'))
          }
        })
    }
  })
}

/**
 * Load a CID into a blob object URL for <img>/<video>.
 *
 * Flow for followers:
 * 1. Local blockstore (instant if already cached)
 * 2. Dial publisher multiaddrs from the Nostr event, then bitswap with
 *    those peers passed as `providers` (Helia otherwise only asks DHT)
 * 3. Race HTTP gateways in parallel as a secondary path
 */
export async function loadCidAsObjectUrl(
  node: HeliaNode,
  cidString: string,
  mimeTypeOrOpts?: string | null | LoadCidOptions,
  maybeOpts?: LoadCidOptions,
): Promise<string> {
  const opts: LoadCidOptions =
    mimeTypeOrOpts && typeof mimeTypeOrOpts === 'object'
      ? mimeTypeOrOpts
      : {
          ...(maybeOpts ?? {}),
          mimeType:
            (mimeTypeOrOpts as string | null | undefined) ??
            maybeOpts?.mimeType,
        }

  const mimeType = opts.mimeType
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
  const providerAddrs = opts.providerAddrs ?? []
  const cid = CID.parse(cidString)
  const signal = AbortSignal.timeout(timeoutMs)

  const toObjectUrl = (bytes: Uint8Array) => {
    const type = mimeType || 'application/octet-stream'
    const blob = new Blob(
      [
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ],
      { type },
    )
    return URL.createObjectURL(blob)
  }

  // Fast path: already in local IndexedDB blockstore (uploader / prior seed)
  try {
    if (await node.blockstore.has(cid)) {
      return toObjectUrl(await concatUnixFs(node, cid, signal))
    }
  } catch {
    // fall through to network race
  }

  // MUST dial before/while bitswap — fire-and-forget dial left sessions empty
  if (providerAddrs.length > 0) {
    await dialProviderAddrs(
      node,
      providerAddrs,
      Math.min(DIAL_TIMEOUT_MS, timeoutMs),
    )
  }

  const heliaBytes = concatUnixFs(node, cid, signal, providerAddrs)
  const gatewayBytes = fetchCidBytesFromGateways(cidString, signal)

  try {
    const bytes = await Promise.any([heliaBytes, gatewayBytes])
    return toObjectUrl(bytes)
  } catch {
    throw new Error(`Could not load IPFS content ${cidString}`)
  }
}

/** Process-wide avatar blob URLs — avoid re-reading IPFS on every avatar remount. */
const avatarObjectUrls = new Map<string, string>()
const avatarObjectUrlInflight = new Map<string, Promise<string>>()

export async function loadAvatarObjectUrl(
  node: HeliaNode,
  cidString: string,
  mimeType: string = 'image/jpeg',
): Promise<string> {
  const cached = avatarObjectUrls.get(cidString)
  if (cached) return cached

  const inflight = avatarObjectUrlInflight.get(cidString)
  if (inflight) return inflight

  const pending = loadCidAsObjectUrl(node, cidString, {
    mimeType,
    timeoutMs: 20_000,
  })
    .then((url) => {
      avatarObjectUrls.set(cidString, url)
      avatarObjectUrlInflight.delete(cidString)
      return url
    })
    .catch((err) => {
      avatarObjectUrlInflight.delete(cidString)
      throw err
    })

  avatarObjectUrlInflight.set(cidString, pending)
  return pending
}

/** Test helper */
export function clearAvatarObjectUrlCache(): void {
  for (const url of avatarObjectUrls.values()) {
    URL.revokeObjectURL(url)
  }
  avatarObjectUrls.clear()
  avatarObjectUrlInflight.clear()
}
