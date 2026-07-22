import { useCallback, useEffect, useState } from 'react'
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
  const people: ProfilePerson[] = []
  for (const pubkey of pubkeys) {
    const local = await getAccountByPubkey(pubkey)
    people.push({ pubkey, username: local?.username ?? null })
  }
  return people
}

/**
 * Instagram-style profile stats: posts, followers, following.
 * Following comes from Kind 3; followers from Kind 3 `#p` mentions;
 * posts from author Kind 1 / video events.
 */
export function useProfileStats(
  pubkey: string | null | undefined,
): UseProfileStatsResult {
  const [following, setFollowing] = useState<ProfilePerson[]>([])
  const [followers, setFollowers] = useState<ProfilePerson[]>([])
  const [postsCount, setPostsCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!pubkey) {
      setFollowing([])
      setFollowers([])
      setPostsCount(0)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const cached = await db.profileStats.get(pubkey)
      if (cached) {
        setFollowing(await resolvePeople(cached.following))
        setFollowers(await resolvePeople(cached.followers))
        setPostsCount(cached.postCount)
      }

      const cachedPosts = await loadCachedPostsByAuthor(pubkey)
      if (cachedPosts.length > 0) {
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
      // Keep legacy follows cache in sync
      await db.follows.put({
        pubkey,
        following: followingKeys,
        updatedAt,
      })

      setFollowing(await resolvePeople(followingKeys))
      setFollowers(await resolvePeople(followerKeys))
      setPostsCount(postCount)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile stats')
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
