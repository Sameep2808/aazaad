import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSocialGraph } from './useSocialGraph'
import {
  acceptRequest,
  blockPeer,
  DM_UPDATED_EVENT,
  ingestDmEvents,
  isBlocked,
  loadMessages,
  markThreadRead,
  resolveDmFolder,
  subscribePeerDmEvents,
  syncPeerDmsFromRelays,
} from '../lib/dm'
import { sendEncryptedDm } from '../lib/sendDm'
import type { DmMessageRow } from '../lib/db'
import { db } from '../lib/db'
import { normalizePubkey } from '../lib/nostr'

/** Fast catch-up while a chat is open (peer-scoped query). */
const CHAT_POLL_MS = 2_500

export function useDmChat(peerPubkey: string | null) {
  const { pubkey, encryptDm, decryptDm, signEvent, canDm } = useAuth()
  const { following } = useSocialGraph(pubkey)
  const [messages, setMessages] = useState<DmMessageRow[]>([])
  const [folder, setFolder] = useState<'primary' | 'request'>('primary')
  const [blocked, setBlocked] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const followingRef = useRef(following)
  followingRef.current = following
  const decryptRef = useRef(decryptDm)
  decryptRef.current = decryptDm
  const syncingRef = useRef(false)
  const inFlightRef = useRef(0)

  const reloadLocal = useCallback(async () => {
    if (!pubkey || !peerPubkey) {
      setMessages([])
      return
    }
    const owner = normalizePubkey(pubkey)
    const peer = normalizePubkey(peerPubkey)
    setBlocked(await isBlocked(owner, peer))
    setFolder(await resolveDmFolder(owner, peer, followingRef.current))
    setMessages(await loadMessages(owner, peer))
    await markThreadRead(owner, peer)
  }, [pubkey, peerPubkey])

  const syncPeer = useCallback(async () => {
    if (!pubkey || !peerPubkey || !canDm) {
      await reloadLocal()
      return
    }
    if (syncingRef.current) return
    syncingRef.current = true
    try {
      await syncPeerDmsFromRelays({
        ownerPubkey: pubkey,
        peerPubkey,
        following: followingRef.current,
        decryptDm: decryptRef.current,
      })
      await reloadLocal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync messages')
      await reloadLocal()
    } finally {
      syncingRef.current = false
    }
  }, [pubkey, peerPubkey, canDm, reloadLocal])

  useEffect(() => {
    void reloadLocal()
  }, [reloadLocal])

  useEffect(() => {
    void syncPeer()
  }, [syncPeer])

  // Fast poll + react to local DM writes
  useEffect(() => {
    if (!pubkey || !peerPubkey || !canDm) return

    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncPeer()
    }, CHAT_POLL_MS)

    function onVisibility() {
      if (document.visibilityState === 'visible') void syncPeer()
    }
    function onDmUpdated() {
      void reloadLocal()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(DM_UPDATED_EVENT, onDmUpdated)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(DM_UPDATED_EVENT, onDmUpdated)
    }
  }, [pubkey, peerPubkey, canDm, syncPeer, reloadLocal])

  // Live peer-scoped subscription
  useEffect(() => {
    if (!pubkey || !peerPubkey || !canDm) return
    const owner = normalizePubkey(pubkey)
    const peer = normalizePubkey(peerPubkey)
    const sub = subscribePeerDmEvents(owner, peer, (event) => {
      void ingestDmEvents({
        ownerPubkey: owner,
        events: [event],
        following: followingRef.current,
        decryptDm: decryptRef.current,
      }).then(async (n) => {
        if (n > 0) {
          setMessages(await loadMessages(owner, peer))
          await markThreadRead(owner, peer)
        }
      })
    })
    return () => sub.close()
  }, [pubkey, peerPubkey, canDm])

  const send = useCallback(
    async (text: string) => {
      if (!pubkey || !peerPubkey) {
        setError('Log in to send messages')
        return false
      }
      if (!canDm) {
        setError('Encrypted messaging unavailable for this login')
        return false
      }
      const owner = normalizePubkey(pubkey)
      const peer = normalizePubkey(peerPubkey)
      if (await isBlocked(owner, peer)) {
        setError('You blocked this user')
        return false
      }
      const trimmed = text.trim()
      if (!trimmed) return false

      // Optimistic bubble so rapid back-and-forth feels instant
      const tempId = `pending:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
      const optimistic: DmMessageRow = {
        id: tempId,
        ownerPubkey: owner,
        peerPubkey: peer,
        createdAt: Date.now(),
        content: trimmed,
        direction: 'out',
        eventJson: '',
      }
      setMessages((prev) => [...prev, optimistic])
      setError(null)
      inFlightRef.current += 1
      setSending(true)

      try {
        await sendEncryptedDm({
          ownerPubkey: owner,
          peerPubkey: peer,
          plaintext: trimmed,
          following: followingRef.current,
          encryptDm,
          signEvent,
        })
        setMessages(await loadMessages(owner, peer))
        setFolder('primary')
        return true
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        setError(err instanceof Error ? err.message : 'Send failed')
        return false
      } finally {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1)
        if (inFlightRef.current === 0) setSending(false)
      }
    },
    [pubkey, peerPubkey, canDm, encryptDm, signEvent],
  )

  const accept = useCallback(async () => {
    if (!pubkey || !peerPubkey) return
    await acceptRequest(pubkey, peerPubkey)
    await reloadLocal()
  }, [pubkey, peerPubkey, reloadLocal])

  const block = useCallback(async () => {
    if (!pubkey || !peerPubkey) return
    const owner = normalizePubkey(pubkey)
    const peer = normalizePubkey(peerPubkey)
    await blockPeer(owner, peer)
    await db.dmMessages
      .where('[ownerPubkey+peerPubkey]')
      .equals([owner, peer])
      .delete()
    setBlocked(true)
    setMessages([])
  }, [pubkey, peerPubkey])

  return {
    messages,
    folder,
    blocked,
    sending,
    error,
    send,
    accept,
    block,
    refresh: syncPeer,
    clearError: () => setError(null),
  }
}
