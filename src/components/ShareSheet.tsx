import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Search, Send, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSocialGraph } from '../hooks/useSocialGraph'
import { useUserSearch } from '../hooks/useUserSearch'
import { useProfiles } from '../hooks/useProfiles'
import { sendEncryptedDm } from '../lib/sendDm'
import { formatSharedPostDm } from '../lib/sharePost'
import { isBlocked } from '../lib/dm'
import { displayHandle, type ResolvedProfile } from '../lib/profiles'
import type { FeedPost } from '../lib/posts'
import { UserAvatar } from './UserAvatar'

interface ShareSheetProps {
  post: FeedPost
  open: boolean
  onClose: () => void
  onShared?: (count: number) => void
}

function PersonRow({
  profile,
  selected,
  onToggle,
}: {
  profile: ResolvedProfile
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full touch-manipulation items-center gap-3 px-4 py-2.5 text-left active:bg-zinc-900/80"
    >
      <UserAvatar profile={profile} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-100">
          {displayHandle(profile)}
        </p>
        <p className="truncate font-mono text-[10px] text-zinc-500">
          {profile.pubkey.slice(0, 16)}…
        </p>
      </div>
      <span
        className={[
          'flex h-6 w-6 items-center justify-center rounded-full border',
          selected
            ? 'border-sky-500 bg-sky-500 text-white'
            : 'border-zinc-600 text-transparent',
        ].join(' ')}
      >
        <Check className="h-3.5 w-3.5" />
      </span>
    </button>
  )
}

export function ShareSheet({ post, open, onClose, onShared }: ShareSheetProps) {
  const { pubkey, encryptDm, signEvent, canDm } = useAuth()
  const { following } = useSocialGraph(pubkey)
  const search = useUserSearch()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const followingKeys = useMemo(
    () => following.filter((pk) => pk !== pubkey),
    [following, pubkey],
  )
  const searchKeys = useMemo(
    () => search.results.map((r) => r.pubkey),
    [search.results],
  )
  const profileKeys = useMemo(
    () => [...new Set([...followingKeys, ...searchKeys, ...selected])],
    [followingKeys, searchKeys, selected],
  )
  const { get: getProfile } = useProfiles(profileKeys)

  useEffect(() => {
    if (!open) {
      setSelected(new Set())
      setNote('')
      setError(null)
      search.setQuery('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when sheet closes/opens
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function toggle(peer: string) {
    const pk = peer.toLowerCase()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pk)) next.delete(pk)
      else next.add(pk)
      return next
    })
  }

  async function onSend() {
    if (!pubkey) {
      setError('Log in to share posts')
      return
    }
    if (!canDm) {
      setError('Encrypted messaging unavailable for this login')
      return
    }
    if (selected.size === 0) {
      setError('Select at least one person')
      return
    }

    setSending(true)
    setError(null)
    const author = getProfile(post.pubkey)
    const body = formatSharedPostDm(post, author, note)
    let sent = 0
    const failures: string[] = []

    for (const peer of selected) {
      try {
        if (await isBlocked(pubkey, peer)) {
          failures.push('blocked')
          continue
        }
        await sendEncryptedDm({
          ownerPubkey: pubkey,
          peerPubkey: peer,
          plaintext: body,
          following,
          encryptDm,
          signEvent,
        })
        sent += 1
      } catch (err) {
        failures.push(err instanceof Error ? err.message : 'failed')
      }
    }

    setSending(false)
    if (sent > 0) {
      onShared?.(sent)
      onClose()
      return
    }
    setError(
      failures[0]
        ? `Couldn’t send: ${failures[0]}`
        : 'Couldn’t send to anyone',
    )
  }

  const searching = search.query.trim().length > 0
  const followingProfiles: ResolvedProfile[] = followingKeys.map(
    (pk) =>
      getProfile(pk) ?? {
        pubkey: pk,
        username: null,
        displayName: null,
        pictureUrl: null,
        pictureCid: null,
      },
  )
  const searchProfiles = search.results.filter(
    (p) => p.pubkey.toLowerCase() !== pubkey?.toLowerCase(),
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close share"
        onClick={onClose}
      />
      <div
        className="relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Share post"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-100">Share</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 active:bg-zinc-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!pubkey ? (
          <div className="space-y-3 px-4 py-8 text-center">
            <p className="text-sm text-zinc-300">Log in to share posts in DMs</p>
            <Link to="/profile" className="text-sm text-sky-400 underline" onClick={onClose}>
              Go to Profile
            </Link>
          </div>
        ) : (
          <>
            <div className="space-y-3 border-b border-zinc-900 px-4 py-3">
              <label className="relative block">
                <span className="sr-only">Search people</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="search"
                  value={search.query}
                  onChange={(e) => search.setQuery(e.target.value)}
                  placeholder="Search @userid or npub"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-h-11 w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2.5 pl-10 pr-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                />
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Write a message…"
                maxLength={280}
                className="min-h-11 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {searching ? (
                <>
                  {search.loading && (
                    <p className="px-4 py-3 text-sm text-zinc-500">Searching…</p>
                  )}
                  {searchProfiles.length === 0 && !search.loading && (
                    <p className="px-4 py-6 text-center text-sm text-zinc-500">
                      No people found
                    </p>
                  )}
                  {searchProfiles.map((profile) => (
                    <PersonRow
                      key={profile.pubkey}
                      profile={profile}
                      selected={selected.has(profile.pubkey.toLowerCase())}
                      onToggle={() => toggle(profile.pubkey)}
                    />
                  ))}
                </>
              ) : (
                <>
                  <p className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Following
                  </p>
                  {followingProfiles.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-zinc-500">
                      Follow people or search by @userid / npub to share.
                    </p>
                  ) : (
                    followingProfiles.map((profile) => (
                      <PersonRow
                        key={profile.pubkey}
                        profile={profile}
                        selected={selected.has(profile.pubkey.toLowerCase())}
                        onToggle={() => toggle(profile.pubkey)}
                      />
                    ))
                  )}
                </>
              )}
            </div>

            {error && (
              <p className="border-t border-zinc-900 px-4 py-2 text-sm text-amber-400">
                {error}
              </p>
            )}

            <div className="border-t border-zinc-800 px-4 py-3">
              <button
                type="button"
                disabled={sending || selected.size === 0}
                onClick={() => void onSend()}
                className="flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-zinc-950 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
                {sending
                  ? 'Sending…'
                  : selected.size === 0
                    ? 'Send'
                    : `Send to ${selected.size}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
