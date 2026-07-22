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
  type HeliaNode,
} from '../lib/ipfs'

interface HeliaContextValue {
  helia: HeliaNode | null
  ready: boolean
  error: string | null
  retry: () => void
}

const HeliaContext = createContext<HeliaContextValue | null>(null)

export function HeliaProvider({ children }: { children: ReactNode }) {
  const [helia, setHelia] = useState<HeliaNode | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bootId, setBootId] = useState(0)

  useEffect(() => {
    let cancelled = false
    let node: HeliaNode | null = null

    async function boot() {
      setReady(false)
      setError(null)
      try {
        node = await createHeliaNode()
        if (cancelled) {
          await node.stop()
          return
        }
        setHelia(node)
        setReady(true)
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
      if (node) {
        void node.stop()
      }
      setHelia(null)
    }
  }, [bootId])

  const retry = useCallback(() => {
    setBootId((n) => n + 1)
  }, [])

  const value = useMemo(
    () => ({ helia, ready, error, retry }),
    [helia, ready, error, retry],
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
