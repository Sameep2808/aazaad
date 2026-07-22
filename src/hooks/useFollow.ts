import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  buildContactListEvent,
  fetchContactListEvents,
  latestContactList,
  parseContactList,
  publishEvent,
} from '../lib/nostr'
import { db } from '../lib/db'

/**
 * Follow / unfollow a pubkey by republishing Kind 3 contact list.
 */
export function useFollow(targetPubkey: string | null | undefined) {
  const { pubkey, signEvent } = useAuth()
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!pubkey || !targetPubkey) {
      setFollowing(false)
      return
    }
    const cached = await db.follows.get(pubkey)
    if (cached?.following.includes(targetPubkey)) {
      setFollowing(true)
      return
    }
    try {
      const events = await fetchContactListEvents(pubkey)
      const latest = latestContactList(events)
      const list = latest ? parseContactList(latest) : []
      await db.follows.put({
        pubkey,
        following: list,
        updatedAt: Date.now(),
      })
      setFollowing(list.includes(targetPubkey))
    } catch {
      setFollowing(Boolean(cached?.following.includes(targetPubkey)))
    }
  }, [pubkey, targetPubkey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = useCallback(async () => {
    if (!pubkey) {
      setError('Log in to follow people')
      return false
    }
    if (!targetPubkey || targetPubkey === pubkey) return false
    if (busy) return false

    setBusy(true)
    setError(null)
    const wasFollowing = following
    setFollowing(!wasFollowing)

    try {
      const cached = await db.follows.get(pubkey)
      let list = cached?.following ? [...cached.following] : []
      if (list.length === 0) {
        const events = await fetchContactListEvents(pubkey)
        const latest = latestContactList(events)
        list = latest ? parseContactList(latest) : []
      }

      if (wasFollowing) {
        list = list.filter((pk) => pk !== targetPubkey)
      } else if (!list.includes(targetPubkey)) {
        list = [...list, targetPubkey]
      }

      const signed = await signEvent(buildContactListEvent(list))
      await db.follows.put({
        pubkey,
        following: list,
        updatedAt: Date.now(),
      })
      void publishEvent(signed)
      setFollowing(list.includes(targetPubkey))
      return true
    } catch (err) {
      setFollowing(wasFollowing)
      setError(err instanceof Error ? err.message : 'Follow failed')
      return false
    } finally {
      setBusy(false)
    }
  }, [pubkey, targetPubkey, signEvent, busy, following])

  return {
    following,
    busy,
    error,
    toggle,
    refresh,
    clearError: () => setError(null),
    isSelf: Boolean(pubkey && targetPubkey && pubkey === targetPubkey),
    canFollow: Boolean(pubkey && targetPubkey && pubkey !== targetPubkey),
  }
}
