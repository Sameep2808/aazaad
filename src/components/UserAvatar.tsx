import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHelia } from '../context/HeliaContext'
import { loadCidAsObjectUrl } from '../lib/ipfs'
import { IPFS_GATEWAYS, cidToGatewayUrl } from '../lib/media'
import {
  displayHandle,
  initialsFromProfile,
  type ResolvedProfile,
} from '../lib/profiles'
import { profilePath } from '../lib/userSearch'

interface UserAvatarProps {
  profile?: ResolvedProfile | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const SIZE = {
  sm: 'h-8 w-8 text-[10px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-11 w-11 text-sm',
  xl: 'h-20 w-20 text-2xl',
} as const

export function UserAvatar({
  profile,
  size = 'md',
  className = '',
}: UserAvatarProps) {
  const { helia, ready } = useHelia()
  const [src, setSrc] = useState<string | null>(profile?.pictureUrl ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    setSrc(profile?.pictureUrl ?? null)
  }, [profile?.pictureUrl, profile?.pictureCid, profile?.pubkey])

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false

    async function tryLocal() {
      if (!profile?.pictureCid || !helia || !ready) return
      try {
        const url = await loadCidAsObjectUrl(
          helia,
          profile.pictureCid,
          'image/jpeg',
        )
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        revoked = url
        setSrc(url)
        setFailed(false)
      } catch {
        // keep gateway url
      }
    }

    void tryLocal()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [helia, ready, profile?.pictureCid])

  const sizeClass = SIZE[size]

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={displayHandle(profile)}
        className={`shrink-0 rounded-full object-cover ${sizeClass} ${className}`}
        onError={() => {
          if (profile?.pictureCid) {
            const next = cidToGatewayUrl(profile.pictureCid, IPFS_GATEWAYS[1])
            if (src !== next) {
              setSrc(next)
              return
            }
          }
          setFailed(true)
        }}
      />
    )
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-600 to-zinc-800 font-semibold uppercase text-white ${sizeClass} ${className}`}
      aria-hidden
    >
      {initialsFromProfile(profile)}
    </div>
  )
}

interface PostAuthorBarProps {
  profile?: ResolvedProfile | null
  pubkey: string
  variant?: 'feed' | 'reel'
}

/** Instagram-style author row: avatar + @userid → user profile */
export function PostAuthorBar({
  profile,
  pubkey,
  variant = 'feed',
}: PostAuthorBarProps) {
  const handle = displayHandle(
    profile ?? {
      pubkey,
      username: null,
      displayName: null,
      pictureUrl: null,
      pictureCid: null,
    },
  )
  const to = profilePath(pubkey)

  if (variant === 'reel') {
    return (
      <Link
        to={to}
        className="flex items-center gap-2 active:opacity-80"
        onClick={(e) => e.stopPropagation()}
      >
        <UserAvatar profile={profile} size="sm" className="ring-1 ring-white/40" />
        <span className="text-sm font-semibold text-white drop-shadow">
          {handle}
        </span>
      </Link>
    )
  }

  return (
    <Link
      to={to}
      className="flex min-w-0 items-center gap-2.5 px-4 py-2.5 active:opacity-80"
    >
      <UserAvatar profile={profile} size="md" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-100">{handle}</p>
      </div>
    </Link>
  )
}
