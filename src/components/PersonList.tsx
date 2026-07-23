import { Link } from 'react-router-dom'
import { useProfiles } from '../hooks/useProfiles'
import {
  displayHandle,
  type ResolvedProfile,
} from '../lib/profiles'
import { profilePath } from '../lib/userSearch'
import { UserAvatar } from './UserAvatar'

interface PersonListProps {
  title: string
  /** Pubkeys (and optional already-resolved fields) for followers / following. */
  people: Array<Pick<ResolvedProfile, 'pubkey'> & Partial<ResolvedProfile>>
  empty: string
}

/**
 * Followers / following list with cached @userids and avatars.
 * Reuses the shared profile memory cache via useProfiles.
 */
export function PersonList({ title, people, empty }: PersonListProps) {
  const pubkeys = people.map((p) => p.pubkey)
  const { get: getProfile } = useProfiles(pubkeys)

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      {people.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="max-h-56 space-y-2 overflow-y-auto">
          {people.map((person) => {
            const cached = getProfile(person.pubkey)
            const profile: ResolvedProfile = {
              pubkey: person.pubkey,
              username: cached?.username ?? person.username ?? null,
              displayName: cached?.displayName ?? person.displayName ?? null,
              pictureUrl: cached?.pictureUrl ?? person.pictureUrl ?? null,
              pictureCid: cached?.pictureCid ?? person.pictureCid ?? null,
            }
            return (
              <li key={person.pubkey}>
                <Link
                  to={profilePath(person.pubkey)}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2 hover:bg-zinc-900/80"
                >
                  <UserAvatar profile={profile} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {displayHandle(profile)}
                    </p>
                    <p className="truncate font-mono text-[10px] text-zinc-500">
                      {person.pubkey.slice(0, 16)}…
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
