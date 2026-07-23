import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BLOCKS_CHANGED_EVENT,
  blockUser,
  getBlockedSet,
  listBlockedPubkeys,
  unblockUser,
} from '../lib/blocks'
import { isBlocked } from '../lib/dm'

/**
 * Local block list for the logged-in viewer. Updates when any screen blocks/unblocks.
 */
export function useBlockedPubkeys(ownerPubkey: string | null | undefined) {
  const [blockedList, setBlockedList] = useState<string[]>([])
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    if (!ownerPubkey) {
      setBlockedList([])
      setReady(true)
      return
    }
    const list = await listBlockedPubkeys(ownerPubkey)
    setBlockedList(list)
    setReady(true)
  }, [ownerPubkey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    function onChange() {
      void refresh()
    }
    window.addEventListener(BLOCKS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(BLOCKS_CHANGED_EVENT, onChange)
  }, [refresh])

  const blocked = useMemo(() => new Set(blockedList), [blockedList])
  const blockedKey = useMemo(() => [...blockedList].sort().join(','), [blockedList])

  const checkBlocked = useCallback(
    async (peerPubkey: string) => {
      if (!ownerPubkey) return false
      return isBlocked(ownerPubkey, peerPubkey)
    },
    [ownerPubkey],
  )

  const block = useCallback(
    async (peerPubkey: string) => {
      if (!ownerPubkey) throw new Error('Log in to block users')
      await blockUser(ownerPubkey, peerPubkey)
    },
    [ownerPubkey],
  )

  const unblock = useCallback(
    async (peerPubkey: string) => {
      if (!ownerPubkey) throw new Error('Log in to unblock users')
      await unblockUser(ownerPubkey, peerPubkey)
    },
    [ownerPubkey],
  )

  return {
    blocked,
    blockedList,
    blockedKey,
    ready,
    refresh,
    isBlocked: (peer: string) => blocked.has(peer.toLowerCase()),
    checkBlocked,
    block,
    unblock,
    /** Stable empty set helper for feeds before ready */
    getBlockedSet: () => getBlockedSet(ownerPubkey),
  }
}
