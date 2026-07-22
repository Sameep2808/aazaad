import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSocialGraph } from './useSocialGraph'
import {
  acceptRequest,
  blockPeer,
  cacheAndIndexDm,
  fetchDmEvents,
  isBlocked,
  loadThreads,
  peerFromDmEvent,
  type DmFolder,
} from '../lib/dm'
import type { DmThreadRow } from '../lib/db'
import { db } from '../lib/db'

export function useDmInbox(folder: DmFolder) {
  const { pubkey, decryptDm, canDm, ready } = useAuth()
  const { following } = useSocialGraph(pubkey)
  const [threads, setThreads] = useState<DmThreadRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestCount, setRequestCount] = useState(0)

  const refreshLocal = useCallback(async () => {
    if (!pubkey) {
      setThreads([])
      setRequestCount(0)
      return
    }
    const [primary, requests] = await Promise.all([
      loadThreads(pubkey, 'primary'),
      loadThreads(pubkey, 'request'),
    ])
    setThreads(folder === 'primary' ? primary : requests)
    setRequestCount(requests.length)
  }, [pubkey, folder])

  const sync = useCallback(async () => {
    if (!pubkey || !canDm) {
      await refreshLocal()
      return
    }
    setLoading(true)
    setError(null)
    try {
      await refreshLocal()
      const events = await fetchDmEvents(pubkey)
      events.sort((a, b) => a.created_at - b.created_at)

      for (const event of events) {
        const peer = peerFromDmEvent(event, pubkey)
        if (!peer) continue
        if (await isBlocked(pubkey, peer)) continue
        if (await db.dmMessages.get(event.id)) continue

        try {
          const plaintext = await decryptDm(peer, event.content)
          await cacheAndIndexDm({
            ownerPubkey: pubkey,
            event,
            plaintext,
            following,
          })
        } catch {
          // skip undecryptable / foreign
        }
      }
      await refreshLocal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [pubkey, canDm, decryptDm, following, refreshLocal])

  useEffect(() => {
    if (!ready) return
    void sync()
  }, [ready, sync])

  const accept = useCallback(
    async (peerPubkey: string) => {
      if (!pubkey) return
      await acceptRequest(pubkey, peerPubkey)
      await refreshLocal()
    },
    [pubkey, refreshLocal],
  )

  const block = useCallback(
    async (peerPubkey: string) => {
      if (!pubkey) return
      await blockPeer(pubkey, peerPubkey)
      await db.dmMessages
        .where('[ownerPubkey+peerPubkey]')
        .equals([pubkey, peerPubkey])
        .delete()
      await refreshLocal()
    },
    [pubkey, refreshLocal],
  )

  return {
    threads,
    loading,
    error,
    requestCount,
    refresh: sync,
    accept,
    block,
  }
}
