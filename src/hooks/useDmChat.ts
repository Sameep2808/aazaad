import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSocialGraph } from './useSocialGraph'
import {
  acceptRequest,
  blockPeer,
  buildEncryptedDmEvent,
  cacheAndIndexDm,
  isBlocked,
  loadMessages,
  markThreadRead,
  publishEvent,
  resolveDmFolder,
} from '../lib/dm'
import type { DmMessageRow } from '../lib/db'
import { db } from '../lib/db'

export function useDmChat(peerPubkey: string | null) {
  const { pubkey, encryptDm, signEvent, canDm } = useAuth()
  const { following } = useSocialGraph(pubkey)
  const [messages, setMessages] = useState<DmMessageRow[]>([])
  const [folder, setFolder] = useState<'primary' | 'request'>('primary')
  const [blocked, setBlocked] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!pubkey || !peerPubkey) {
      setMessages([])
      return
    }
    const peer = peerPubkey.toLowerCase()
    setBlocked(await isBlocked(pubkey, peer))
    setFolder(await resolveDmFolder(pubkey, peer, following))
    setMessages(await loadMessages(pubkey, peer))
    await markThreadRead(pubkey, peer)
  }, [pubkey, peerPubkey, following])

  useEffect(() => {
    void reload()
  }, [reload])

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
      const peer = peerPubkey.toLowerCase()
      if (await isBlocked(pubkey, peer)) {
        setError('You blocked this user')
        return false
      }
      const trimmed = text.trim()
      if (!trimmed) return false

      setSending(true)
      setError(null)
      try {
        const ciphertext = await encryptDm(peer, trimmed)
        const signed = await signEvent(buildEncryptedDmEvent(peer, ciphertext))
        await cacheAndIndexDm({
          ownerPubkey: pubkey,
          event: signed,
          plaintext: trimmed,
          following,
        })
        void publishEvent(signed)
        await reload()
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Send failed')
        return false
      } finally {
        setSending(false)
      }
    },
    [
      pubkey,
      peerPubkey,
      canDm,
      encryptDm,
      signEvent,
      following,
      reload,
    ],
  )

  const accept = useCallback(async () => {
    if (!pubkey || !peerPubkey) return
    await acceptRequest(pubkey, peerPubkey)
    await reload()
  }, [pubkey, peerPubkey, reload])

  const block = useCallback(async () => {
    if (!pubkey || !peerPubkey) return
    const peer = peerPubkey.toLowerCase()
    await blockPeer(pubkey, peer)
    await db.dmMessages
      .where('[ownerPubkey+peerPubkey]')
      .equals([pubkey, peer])
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
    refresh: reload,
    clearError: () => setError(null),
  }
}
