import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  createHeliaNode,
  getPeerMultiaddrs,
  reprovideLocalPins,
  waitForDialableAddrs,
  type HeliaNode,
} from '../lib/ipfs'

/** DHT provider records expire; refresh while the tab stays open. */
const REPROVIDE_INTERVAL_MS = 20 * 60 * 1000

interface HeliaContextValue {
  helia: HeliaNode | null
  ready: boolean
  error: string | null
  retry: () => void
  /** Current dialable multiaddrs (circuit / webrtc), refreshed after boot. */
  multiaddrs: string[]
  /** Wait for relay/WebRTC listen addresses (used when publishing media). */
  waitForMultiaddrs: (timeoutMs?: number) => Promise<string[]>
}

const HeliaContext = createContext<HeliaContextValue | null>(null)

export function HeliaProvider({ children }: { children: ReactNode }) {
  const [helia, setHelia] = useState<HeliaNode | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bootId, setBootId] = useState(0)
  const [multiaddrs, setMultiaddrs] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    let node: HeliaNode | null = null
    let reprovideTimer: number | undefined

    async function boot() {
      setReady(false)
      setError(null)
      setMultiaddrs([])
      try {
        node = await createHeliaNode()
        if (cancelled) {
          await node.stop()
          return
        }
        setHelia(node)
        setReady(true)

        // Re-announce local pins so followers can find us after reload
        void waitForDialableAddrs(node, 10_000).then(async (addrs) => {
          if (cancelled) return
          setMultiaddrs(addrs)
          await reprovideLocalPins(node!)
        })

        reprovideTimer = window.setInterval(() => {
          if (!node || cancelled) return
          setMultiaddrs(getPeerMultiaddrs(node))
          void reprovideLocalPins(node)
        }, REPROVIDE_INTERVAL_MS)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to start Helia')
          setReady(false)
        }
      }
    }

    void boot()

    return () => {
      cancelled = true
      if (reprovideTimer !== undefined) window.clearInterval(reprovideTimer)
      if (node) {
        void node.stop()
      }
      setHelia(null)
      setMultiaddrs([])
    }
  }, [bootId])

  const retry = useCallback(() => {
    setBootId((n) => n + 1)
  }, [])

  const waitForMultiaddrs = useCallback(
    async (timeoutMs = 8_000) => {
      if (!helia) return []
      const addrs = await waitForDialableAddrs(helia, timeoutMs)
      setMultiaddrs(addrs)
      return addrs
    },
    [helia],
  )

  const value = useMemo(
    () => ({
      helia,
      ready,
      error,
      retry,
      multiaddrs,
      waitForMultiaddrs,
    }),
    [helia, ready, error, retry, multiaddrs, waitForMultiaddrs],
  )

  return (
    <HeliaContext.Provider value={value}>{children}</HeliaContext.Provider>
  )
}

export function useHelia(): HeliaContextValue {
  const ctx = useContext(HeliaContext)
  if (!ctx) {
    throw new Error('useHelia must be used within HeliaProvider')
  }
  return ctx
}
