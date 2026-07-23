import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSocialGraph } from './useSocialGraph'
import {
  acceptRequest,
  blockPeer,
  DM_UPDATED_EVENT,
  ingestDmEvents,
  loadThreads,
  subscribeDmEvents,
  syncDmsFromRelays,
  type DmFolder,
} from '../lib/dm'
import type { DmThreadRow } from '../lib/db'
import { db } from '../lib/db'
import { normalizePubkey } from '../lib/nostr'

const DM_POLL_MS = 12_000

export function useDmInbox(folder: DmFolder) {
  const { pubkey, decryptDm, canDm, ready } = useAuth()
  const { following } = useSocialGraph(pubkey)
  const [threads, setThreads] = useState<DmThreadRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestCount, setRequestCount] = useState(0)

  const followingRef = useRef(following)
  followingRef.current = following
  const folderRef = useRef(folder)
  folderRef.current = folder
  const syncingRef = useRef(false)
  const decryptRef = useRef(decryptDm)
  decryptRef.current = decryptDm

  const refreshLocal = useCallback(async () => {
    if (!pubkey) {
      setThreads([])
      setRequestCount(0)
      return
    }
    const owner = normalizePubkey(pubkey)
    const [primary, requests] = await Promise.all([
      loadThreads(owner, 'primary'),
      loadThreads(owner, 'request'),
    ])
    setThreads(folderRef.current === 'primary' ? primary : requests)
    setRequestCount(requests.length)
  }, [pubkey])

  const sync = useCallback(async () => {
    if (!pubkey || !canDm) {
      await refreshLocal()
      return
    }
    if (syncingRef.current) return
    syncingRef.current = true
    setLoading(true)
    setError(null)
    try {
      await refreshLocal()
      await syncDmsFromRelays({
        ownerPubkey: pubkey,
        following: followingRef.current,
        decryptDm: decryptRef.current,
      })
      await refreshLocal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      syncingRef.current = false
      setLoading(false)
    }
  }, [pubkey, canDm, refreshLocal])

  // Paint local threads immediately when folder changes (no full relay sync)
  useEffect(() => {
    if (!ready || !pubkey) return
    void refreshLocal()
  }, [ready, pubkey, folder, refreshLocal])

  // Full relay sync on mount / identity change
  useEffect(() => {
    if (!ready) return
    void sync()
  }, [ready, pubkey, canDm, sync])

  // Poll while the Messages screen is mounted / tab visible
  useEffect(() => {
    if (!ready || !pubkey || !canDm) return

    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void sync()
    }, DM_POLL_MS)

    function onVisibility() {
      if (document.visibilityState === 'visible') void sync()
    }
    function onDmUpdated() {
      void refreshLocal()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(DM_UPDATED_EVENT, onDmUpdated)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(DM_UPDATED_EVENT, onDmUpdated)
    }
  }, [ready, pubkey, canDm, sync, refreshLocal])

  // Live subscription for new DMs
  useEffect(() => {
    if (!ready || !pubkey || !canDm) return
    const owner = normalizePubkey(pubkey)
    const sub = subscribeDmEvents(owner, (event) => {
      void ingestDmEvents({
        ownerPubkey: owner,
        events: [event],
        following: followingRef.current,
        decryptDm: decryptRef.current,
      }).then((n) => {
        if (n > 0) void refreshLocal()
      })
    })
    return () => sub.close()
  }, [ready, pubkey, canDm, refreshLocal])

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
      const owner = normalizePubkey(pubkey)
      const peer = normalizePubkey(peerPubkey)
      await blockPeer(owner, peer)
      await db.dmMessages
        .where('[ownerPubkey+peerPubkey]')
        .equals([owner, peer])
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
