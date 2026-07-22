import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { HeliaProvider } from '../context/HeliaContext'
import { useIPFSUpload } from './useIPFSUpload'
import { useIPFSSeed } from './useIPFSSeed'
import { db } from '../lib/db'
import * as ipfs from '../lib/ipfs'

vi.mock('../lib/ipfs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ipfs')>()
  return {
    ...actual,
    createHeliaNode: vi.fn(),
    uploadFileToIPFS: vi.fn(),
    seedCid: vi.fn(),
  }
})

const mockNode = {
  fs: {},
  pins: {},
  blockstore: {},
  stop: vi.fn().mockResolvedValue(undefined),
} as unknown as Awaited<ReturnType<typeof ipfs.createHeliaNode>>

function wrapper({ children }: { children: ReactNode }) {
  return <HeliaProvider>{children}</HeliaProvider>
}

describe('IPFS hooks', () => {
  beforeEach(async () => {
    vi.mocked(ipfs.createHeliaNode).mockResolvedValue(mockNode)
    vi.mocked(ipfs.uploadFileToIPFS).mockResolvedValue('bafytestcid123')
    vi.mocked(ipfs.seedCid).mockResolvedValue(undefined)
    await db.seeds.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('useIPFSUpload uploads via Helia and returns CID', async () => {
    const { result } = renderHook(() => useIPFSUpload(), { wrapper })

    await waitFor(() => {
      // wait for provider boot
      expect(ipfs.createHeliaNode).toHaveBeenCalled()
    })

    // Give provider a tick to set ready
    await waitFor(async () => {
      const file = new File(['hello'], 'hello.txt')
      // may throw until ready — retry via waitFor
      let cid = ''
      await act(async () => {
        try {
          cid = await result.current.upload(file)
        } catch {
          // not ready yet
        }
      })
      expect(cid).toBe('bafytestcid123')
    })

    expect(ipfs.uploadFileToIPFS).toHaveBeenCalled()
    expect(result.current.lastCid).toBe('bafytestcid123')
    expect(result.current.progress).toBe('done')
  })

  it('useIPFSSeed pins CID and records in Dexie', async () => {
    const { result } = renderHook(() => useIPFSSeed(), { wrapper })

    await waitFor(() => expect(ipfs.createHeliaNode).toHaveBeenCalled())

    await waitFor(async () => {
      await act(async () => {
        try {
          await result.current.seed('bafyseedcid')
        } catch {
          // not ready
        }
      })
      const row = await db.seeds.get('bafyseedcid')
      expect(row?.cid).toBe('bafyseedcid')
    })

    expect(ipfs.seedCid).toHaveBeenCalledWith(mockNode, 'bafyseedcid')
    await expect(result.current.isSeeded('bafyseedcid')).resolves.toBe(true)
  })
})
