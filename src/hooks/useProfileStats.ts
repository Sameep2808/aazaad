import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deriveFollowersFromKind3,
  fetchContactListEvents,
  fetchFollowerCandidateEvents,
  latestContactList,
  parseContactList,
} from '../lib/nostr'
import { fetchAuthorMediaEvents } from '../lib/posts'
import { db } from '../lib/db'
import { getAccountByPubkey } from '../lib/accounts'
import { loadCachedPostsByAuthor } from '../lib/postCache'
import { FOLLOWS_CHANGED_EVENT } from '../lib/follows'
import { getCachedProfile } from '../lib/profiles'

export interface ProfilePerson {
  pubkey: string
  username: string | null
}

export interface UseProfileStatsResult {
  following: ProfilePerson[]
  followers: ProfilePerson[]
  followingCount: number
  followersCount: number
  postsCount: number
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

async function resolvePeople(pubkeys: string[]): Promise<ProfilePerson[]> {
  return Promise.all(
    pubkeys.map(async (pubkey) => {
      const local = await getAccountByPubkey(pubkey)
      if (local?.username) {
        return { pubkey, username: local.username }
      }
      const profile = await getCachedProfile(pubkey)
      return { pubkey, username: profile?.username ?? null }
    }),
  )
}

/**
 * Instagram-style profile stats: posts, followers, following.
 * Cache paints first; relays refresh in background.
 */
export function useProfileStats(
  pubkey: string | null | undefined,
): UseProfileStatsResult {
  const [following, setFollowing] = useState<ProfilePerson[]>([])
  const [followers, setFollowers] = useState<ProfilePerson[]>([])
  const [postsCount, setPostsCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pubkeyRef = useRef(pubkey)
  pubkeyRef.current = pubkey

  const applyCache = useCallback(async (pk: string) => {
    const cached = await db.profileStats.get(pk)
    if (cached) {
      const [followingPeople, followerPeople] = await Promise.all([
        resolvePeople(cached.following),
        resolvePeople(cached.followers),
      ])
      if (pubkeyRef.current !== pk) return false
      setFollowing(followingPeople)
      setFollowers(followerPeople)
      setPostsCount(cached.postCount)
      return true
    }
    return false
  }, [])

  const refresh = useCallback(async () => {
    if (!pubkey) {
      setFollowing([])
      setFollowers([])
      setPostsCount(0)
      return
    }

    setError(null)
    const hadCache = await applyCache(pubkey)
    if (!hadCache) setLoading(true)

    try {
      const cachedPosts = await loadCachedPostsByAuthor(pubkey)
      if (cachedPosts.length > 0 && pubkeyRef.current === pubkey) {
        setPostsCount(cachedPosts.length)
      }

      const [contactEvents, followerEvents, mediaEvents] = await Promise.all([
        fetchContactListEvents(pubkey),
        fetchFollowerCandidateEvents(pubkey),
        fetchAuthorMediaEvents(pubkey),
      ])

      const latest = latestContactList(contactEvents)
      const followingKeys = latest ? parseContactList(latest) : []
      const followerKeys = deriveFollowersFromKind3(pubkey, followerEvents)
      const mediaIds = new Set([
        ...cachedPosts.map((p) => p.id),
        ...mediaEvents.map((e) => e.id),
      ])
      const postCount = mediaIds.size
      const updatedAt = Date.now()

      await db.profileStats.put({
        pubkey,
        following: followingKeys,
        followers: followerKeys,
        postCount,
        updatedAt,
      })
      await db.follows.put({
        pubkey,
        following: followingKeys,
        updatedAt,
      })

      if (pubkeyRef.current !== pubkey) return

      const [followingPeople, followerPeople] = await Promise.all([
        resolvePeople(followingKeys),
        resolvePeople(followerKeys),
      ])
      setFollowing(followingPeople)
      setFollowers(followerPeople)
      setPostsCount(postCount)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile stats')
    } finally {
      setLoading(false)
    }
  }, [pubkey, applyCache])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!pubkey) return
    const pk = pubkey
    function onFollowsChanged(event: Event) {
      const custom = event as CustomEvent<{ ownerPubkey: string | null }>
      if (custom.detail?.ownerPubkey && custom.detail.ownerPubkey !== pk) {
        return
      }
      void applyCache(pk)
    }
    window.addEventListener(FOLLOWS_CHANGED_EVENT, onFollowsChanged)
    return () => window.removeEventListener(FOLLOWS_CHANGED_EVENT, onFollowsChanged)
  }, [pubkey, applyCache])

  useEffect(() => {
    if (!pubkey) return
    function onVisibility() {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [pubkey, refresh])

  return {
    following,
    followers,
    followingCount: following.length,
    followersCount: followers.length,
    postsCount,
    loading,
    error,
    refresh,
  }
}
