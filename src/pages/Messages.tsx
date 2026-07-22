import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MessageCircle, Search, ShieldBan, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDmInbox } from '../hooks/useDmInbox'
import { useProfiles } from '../hooks/useProfiles'
import { useUserSearch } from '../hooks/useUserSearch'
import { UserAvatar } from '../components/UserAvatar'
import { displayHandle } from '../lib/profiles'
import { decodePubkey, hexToNpub } from '../lib/nostr'
import { profilePath } from '../lib/userSearch'
import type { DmFolder } from '../lib/dm'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function Messages() {
  const { pubkey, ready } = useAuth()
  const [folder, setFolder] = useState<DmFolder>('primary')
  const navigate = useNavigate()
  const inbox = useDmInbox(folder)
  const {
    query,
    setQuery,
    results: peopleResults,
    loading: searchLoading,
    searched,
  } = useUserSearch()

  const peerIds = useMemo(
    () => inbox.threads.map((t) => t.peerPubkey),
    [inbox.threads],
  )
  const { get: getProfile } = useProfiles(peerIds)

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@+/, '')
    if (!q) return inbox.threads

    const asPubkey = decodePubkey(query.trim())
    return inbox.threads.filter((thread) => {
      if (asPubkey && thread.peerPubkey === asPubkey) return true
      const profile = getProfile(thread.peerPubkey)
      const handle = (profile?.username ?? '').toLowerCase()
      const display = (profile?.displayName ?? '').toLowerCase()
      const npub = hexToNpub(thread.peerPubkey).toLowerCase()
      return (
        handle.includes(q) ||
        display.includes(q) ||
        npub.includes(q) ||
        thread.peerPubkey.includes(q) ||
        thread.lastPreview.toLowerCase().includes(q)
      )
    })
  }, [inbox.threads, query, getProfile])

  const searching = query.trim().length > 0

  // People search results not already shown as a matching thread
  const threadPeerSet = useMemo(
    () => new Set(filteredThreads.map((t) => t.peerPubkey)),
    [filteredThreads],
  )
  const newPeople = useMemo(
    () =>
      peopleResults.filter(
        (p) => p.pubkey !== pubkey && !threadPeerSet.has(p.pubkey),
      ),
    [peopleResults, pubkey, threadPeerSet],
  )

  function openChat(peerHex: string) {
    navigate(`/messages/${hexToNpub(peerHex)}`)
    setQuery('')
  }

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault()
    const peer = decodePubkey(query)
    if (peer && peer !== pubkey) {
      openChat(peer)
      return
    }
    if (newPeople[0]) openChat(newPeople[0].pubkey)
    else if (filteredThreads[0]) openChat(filteredThreads[0].peerPubkey)
  }

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    )
  }

  if (!pubkey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <MessageCircle className="h-10 w-10 text-zinc-600" />
        <p className="text-sm text-zinc-300">Log in to use Messages</p>
        <Link
          to="/profile"
          className="min-h-11 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900"
        >
          Go to Profile
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="px-3 pt-2">
          <h1 className="text-lg font-bold tracking-wide">Messages</h1>
        </div>

        <form onSubmit={onSearchSubmit} className="px-3 py-2">
          <label className="relative block">
            <span className="sr-only">Search messages</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by @userid or npub"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              className="min-h-11 w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2.5 pl-10 pr-10 text-base text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 touch-manipulation items-center justify-center rounded-full text-zinc-500 active:text-zinc-300"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        </form>

        <div className="flex px-2">
          <button
            type="button"
            onClick={() => setFolder('primary')}
            className={[
              'flex-1 border-b-2 py-2.5 text-sm font-semibold',
              folder === 'primary'
                ? 'border-white text-white'
                : 'border-transparent text-zinc-500',
            ].join(' ')}
          >
            Primary
          </button>
          <button
            type="button"
            onClick={() => setFolder('request')}
            className={[
              'flex-1 border-b-2 py-2.5 text-sm font-semibold',
              folder === 'request'
                ? 'border-white text-white'
                : 'border-transparent text-zinc-500',
            ].join(' ')}
          >
            Requests
            {inbox.requestCount > 0 && (
              <span className="ml-1.5 rounded-full bg-zinc-700 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-200">
                {inbox.requestCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="flex items-center justify-end px-3 py-2">
        <button
          type="button"
          onClick={() => void inbox.refresh()}
          className="text-xs text-zinc-400 underline"
        >
          {inbox.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {inbox.error && (
        <p className="px-3 text-sm text-amber-400">{inbox.error}</p>
      )}

      {searching && searchLoading && (
        <p className="px-3 text-sm text-zinc-500">Searching…</p>
      )}

      {searching && newPeople.length > 0 && (
        <div className="border-b border-zinc-900 pb-2">
          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            People
          </p>
          <ul>
            {newPeople.map((user) => (
              <li key={user.pubkey}>
                <button
                  type="button"
                  onClick={() => openChat(user.pubkey)}
                  className="flex w-full touch-manipulation items-center gap-3 px-3 py-2.5 text-left active:bg-zinc-900/80"
                >
                  <UserAvatar profile={user} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {displayHandle(user)}
                    </p>
                    <p className="truncate font-mono text-[10px] text-zinc-500">
                      {hexToNpub(user.pubkey)}
                    </p>
                  </div>
                  <span className="text-xs text-sky-400">Chat</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {filteredThreads.length === 0 && !inbox.loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <MessageCircle className="h-8 w-8 text-zinc-600" />
          <p className="text-sm text-zinc-400">
            {searching
              ? searched && newPeople.length === 0
                ? `No chats or people for “${query.trim()}”`
                : 'No matching chats'
              : folder === 'primary'
                ? 'No primary chats yet. Search for someone by @userid or npub.'
                : 'No message requests. DMs from people you don’t follow show up here.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-900">
          {searching && filteredThreads.length > 0 && (
            <li className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Chats
            </li>
          )}
          {filteredThreads.map((thread) => {
            const profile = getProfile(thread.peerPubkey)
            return (
              <li key={thread.key} className="flex items-stretch">
                <Link
                  to={`/messages/${hexToNpub(thread.peerPubkey)}`}
                  className="flex min-w-0 flex-1 touch-manipulation items-center gap-3 px-3 py-3 active:bg-zinc-900/80"
                >
                  <UserAvatar profile={profile} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-100">
                        {displayHandle(profile)}
                      </p>
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        {formatTime(thread.lastAt)}
                      </span>
                    </div>
                    <p className="truncate text-xs text-zinc-500">
                      {thread.lastPreview || '…'}
                    </p>
                  </div>
                  {thread.unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-bold text-white">
                      {thread.unread}
                    </span>
                  )}
                </Link>

                {folder === 'request' && (
                  <div className="flex flex-col justify-center gap-1 border-l border-zinc-900 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => void inbox.accept(thread.peerPubkey)}
                      className="rounded-lg bg-white px-2 py-1 text-[10px] font-semibold text-zinc-900"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => void inbox.block(thread.peerPubkey)}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300"
                    >
                      Block
                    </button>
                  </div>
                )}

                {folder === 'primary' && (
                  <button
                    type="button"
                    onClick={() => void inbox.block(thread.peerPubkey)}
                    className="flex items-center px-3 text-zinc-500 active:text-red-400"
                    aria-label="Block"
                    title="Block"
                  >
                    <ShieldBan className="h-4 w-4" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="px-4 py-3 text-center text-[10px] text-zinc-600">
        Encrypted with Nostr NIP-04. Profiles:{' '}
        <Link to="/explore" className="underline">
          Explore
        </Link>
        {' · '}
        <Link to={profilePath(pubkey)} className="underline">
          Your profile
        </Link>
      </p>
    </div>
  )
}
