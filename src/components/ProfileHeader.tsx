import { useState } from 'react'
import type { ProfilePerson } from '../hooks/useProfileStats'

type ListTab = 'followers' | 'following' | null

interface ProfileHeaderProps {
  username: string | null
  npub: string | null
  postsCount: number
  followersCount: number
  followingCount: number
  followers: ProfilePerson[]
  following: ProfilePerson[]
  loading: boolean
  onLogout: () => void
  onRefresh: () => void
}

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
            <li
              key={person.pubkey}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold uppercase text-zinc-300">
                {(person.username ?? person.pubkey).slice(0, 2)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {person.username ? `@${person.username}` : 'Unknown'}
                </p>
                <p className="truncate font-mono text-[10px] text-zinc-500">
                  {person.pubkey}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ProfileHeader({
  username,
  npub,
  postsCount,
  followersCount,
  followingCount,
  followers,
  following,
  loading,
  onLogout,
  onRefresh,
}: ProfileHeaderProps) {
  const [listTab, setListTab] = useState<ListTab>(null)
  const displayName = username ? `@${username}` : 'Guest'

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-600 to-zinc-800 text-2xl font-bold uppercase text-white">
          {(username ?? 'aa').slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {displayName}
            </h1>
            <button
              type="button"
              onClick={onRefresh}
              className="shrink-0 text-xs text-zinc-400 underline"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-semibold tabular-nums">{postsCount}</p>
              <p className="text-xs text-zinc-400">posts</p>
            </div>
            <button
              type="button"
              onClick={() => setListTab(listTab === 'followers' ? null : 'followers')}
              className="rounded-md hover:bg-zinc-900"
            >
              <p className="text-lg font-semibold tabular-nums">{followersCount}</p>
              <p className="text-xs text-zinc-400">followers</p>
            </button>
            <button
              type="button"
              onClick={() => setListTab(listTab === 'following' ? null : 'following')}
              className="rounded-md hover:bg-zinc-900"
            >
              <p className="text-lg font-semibold tabular-nums">{followingCount}</p>
              <p className="text-xs text-zinc-400">following</p>
            </button>
          </div>
        </div>
      </div>

      {npub && (
        <p className="break-all font-mono text-[10px] text-zinc-500">{npub}</p>
      )}

      {listTab === 'followers' && (
        <PersonList
          title="Followers"
          people={followers}
          empty="No followers found on relays yet."
        />
      )}
      {listTab === 'following' && (
        <PersonList
          title="Following"
          people={following}
          empty="Not following anyone yet."
        />
      )}

      <button
        type="button"
        onClick={onLogout}
        className="w-full rounded-lg border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-100"
      >
        Log out
      </button>
    </div>
  )
}
