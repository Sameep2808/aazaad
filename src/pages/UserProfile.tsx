import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useProfileStats } from '../hooks/useProfileStats'
import { useUserPosts } from '../hooks/useUserPosts'
import { useUserReposts } from '../hooks/useUserReposts'
import { useFollow } from '../hooks/useFollow'
import { decodePubkey, hexToNpub } from '../lib/nostr'
import {
  displayHandle,
  fetchAndCacheProfile,
  getCachedProfile,
  type ResolvedProfile,
} from '../lib/profiles'
import { UserAvatar } from '../components/UserAvatar'
import { ProfilePostsGrid } from '../components/ProfilePostsGrid'
import type { ProfilePerson } from '../hooks/useProfileStats'
import { profilePath } from '../lib/userSearch'

function PersonList({
  title,
  people,
  empty,
}: {
  title: string
  people: ProfilePerson[]
  empty: string
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      {people.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="max-h-56 space-y-2 overflow-y-auto">
          {people.map((person) => (
            <li key={person.pubkey}>
              <Link
                to={profilePath(person.pubkey)}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2 hover:bg-zinc-900/80"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold uppercase text-zinc-300">
                  {(person.username ?? person.pubkey).slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-100">
                    {person.username ? `@${person.username}` : 'Unknown'}
                  </p>
                  <p className="truncate font-mono text-[10px] text-zinc-500">
                    {person.pubkey.slice(0, 16)}…
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function UserProfile() {
  const { id = '' } = useParams<{ id: string }>()
  const { pubkey: me } = useAuth()
  const targetPubkey = useMemo(() => decodePubkey(id), [id])
  const [profile, setProfile] = useState<ResolvedProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [listTab, setListTab] = useState<'followers' | 'following' | null>(null)
  const [copied, setCopied] = useState(false)

  const stats = useProfileStats(targetPubkey)
  const userPosts = useUserPosts(targetPubkey)
  const userReposts = useUserReposts(targetPubkey)
  const follow = useFollow(targetPubkey)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!targetPubkey) {
        setProfile(null)
        setProfileLoading(false)
        return
      }
      setProfileLoading(true)
      const cached = await getCachedProfile(targetPubkey)
      if (!cancelled && cached) setProfile(cached)
      try {
        const fresh = await fetchAndCacheProfile(targetPubkey)
        if (!cancelled) setProfile(fresh)
      } catch {
        // keep cache
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [targetPubkey])

  if (!targetPubkey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
        <p className="text-sm text-zinc-300">Invalid user id or npub</p>
        <Link to="/explore" className="text-sm text-zinc-400 underline">
          Back to Explore
        </Link>
      </div>
    )
  }

  const isSelf = me === targetPubkey
  const npub = hexToNpub(targetPubkey)
  const postsCount = Math.max(stats.postsCount, userPosts.posts.length)
  const handle = displayHandle(profile)

  async function copyNpub() {
    try {
      await navigator.clipboard.writeText(npub)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = npub
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 py-4">
      <div className="flex items-center gap-3">
        <Link
          to="/explore"
          className="rounded-full p-2 text-zinc-300 hover:bg-zinc-900"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="truncate text-lg font-semibold">{handle}</h1>
      </div>

      <div className="flex items-start gap-4">
        <UserAvatar profile={profile} size="xl" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-xl font-semibold tracking-tight">
              {handle}
            </p>
            {isSelf ? (
              <Link
                to="/profile"
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200"
              >
                Edit profile
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!follow.canFollow || follow.busy}
                  onClick={() => void follow.toggle()}
                  className={[
                    'rounded-lg px-4 py-1.5 text-xs font-semibold disabled:opacity-50',
                    follow.following
                      ? 'border border-zinc-600 text-zinc-200'
                      : 'bg-white text-zinc-950',
                  ].join(' ')}
                >
                  {follow.busy
                    ? '…'
                    : follow.following
                      ? 'Following'
                      : 'Follow'}
                </button>
                <Link
                  to={`/messages/${npub}`}
                  className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200"
                >
                  Message
                </Link>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-semibold tabular-nums">{postsCount}</p>
              <p className="text-xs text-zinc-400">posts</p>
            </div>
            <button
              type="button"
              onClick={() =>
                setListTab(listTab === 'followers' ? null : 'followers')
              }
              className="rounded-md hover:bg-zinc-900"
            >
              <p className="text-lg font-semibold tabular-nums">
                {stats.followersCount}
              </p>
              <p className="text-xs text-zinc-400">followers</p>
            </button>
            <button
              type="button"
              onClick={() =>
                setListTab(listTab === 'following' ? null : 'following')
              }
              className="rounded-md hover:bg-zinc-900"
            >
              <p className="text-lg font-semibold tabular-nums">
                {stats.followingCount}
              </p>
              <p className="text-xs text-zinc-400">following</p>
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          npub id
        </p>
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-zinc-300">
            {npub}
          </p>
          <button
            type="button"
            onClick={() => void copyNpub()}
            className="flex shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-200 active:bg-zinc-800"
            aria-label={copied ? 'Copied' : 'Copy npub id'}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
      {(profileLoading || stats.loading) && (
        <p className="text-xs text-zinc-500">Loading profile…</p>
      )}
      {follow.error && <p className="text-sm text-amber-400">{follow.error}</p>}
      {stats.error && <p className="text-sm text-amber-400">{stats.error}</p>}

      {listTab === 'followers' && (
        <PersonList
          title="Followers"
          people={stats.followers}
          empty="No followers found on relays yet."
        />
      )}
      {listTab === 'following' && (
        <PersonList
          title="Following"
          people={stats.following}
          empty="Not following anyone yet."
        />
      )}

      <ProfilePostsGrid
        posts={userPosts.posts}
        reposts={userReposts.posts}
        loading={userPosts.loading}
        repostsLoading={userReposts.loading}
        error={userPosts.error}
        repostsError={userReposts.error}
        onRefreshPosts={() => void userPosts.refresh()}
        onRefreshReposts={() => void userReposts.refresh()}
      />
    </div>
  )
}
