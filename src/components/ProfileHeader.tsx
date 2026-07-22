import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Check, Copy } from 'lucide-react'
import type { ProfilePerson } from '../hooks/useProfileStats'
import type { ResolvedProfile } from '../lib/profiles'
import { UserAvatar } from './UserAvatar'
import { displayHandle } from '../lib/profiles'
import { profilePath } from '../lib/userSearch'

type ListTab = 'followers' | 'following' | null

interface ProfileHeaderProps {
  username: string | null
  npub: string | null
  profile: ResolvedProfile | null
  postsCount: number
  followersCount: number
  followingCount: number
  followers: ProfilePerson[]
  following: ProfilePerson[]
  loading: boolean
  photoBusy?: boolean
  onLogout: () => void
  onRefresh: () => void
  onChangePhoto: (file: File) => Promise<void>
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
                    {person.pubkey}
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

export function ProfileHeader({
  username,
  npub,
  profile,
  postsCount,
  followersCount,
  followingCount,
  followers,
  following,
  loading,
  photoBusy,
  onLogout,
  onRefresh,
  onChangePhoto,
}: ProfileHeaderProps) {
  const [listTab, setListTab] = useState<ListTab>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const displayName = displayHandle(
    profile ?? {
      pubkey: '',
      username,
      displayName: username,
      pictureUrl: null,
      pictureCid: null,
    },
  )

  useEffect(() => {
    setPhotoError(null)
  }, [profile?.pictureCid])

  async function copyNpub() {
    if (!npub) return
    try {
      await navigator.clipboard.writeText(npub)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Fallback for older webviews
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
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <button
            type="button"
            disabled={photoBusy}
            onClick={() => fileRef.current?.click()}
            className="relative rounded-full focus:outline-none focus:ring-2 focus:ring-zinc-500"
            aria-label="Change profile photo"
          >
            <UserAvatar
              profile={
                profile ?? {
                  pubkey: npub ?? '',
                  username,
                  displayName: username,
                  pictureUrl: null,
                  pictureCid: null,
                }
              }
              size="xl"
            />
            <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-200">
              <Camera className="h-3.5 w-3.5" />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,image/heic,image/heif"
            capture="user"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setPhotoError(null)
              void onChangePhoto(file).catch((err: Error) =>
                setPhotoError(err.message),
              )
            }}
          />
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

          <p className="text-[11px] text-zinc-500">
            {photoBusy ? 'Uploading photo…' : 'Tap photo to change'}
          </p>
          {photoError && <p className="text-xs text-red-400">{photoError}</p>}
        </div>
      </div>

      {npub && (
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
