import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MessageCircle, Plus, ShieldBan } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDmInbox } from '../hooks/useDmInbox'
import { useProfiles } from '../hooks/useProfiles'
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
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeValue, setComposeValue] = useState('')
  const [composeError, setComposeError] = useState<string | null>(null)
  const navigate = useNavigate()
  const inbox = useDmInbox(folder)

  const peerIds = useMemo(
    () => inbox.threads.map((t) => t.peerPubkey),
    [inbox.threads],
  )
  const { get: getProfile } = useProfiles(peerIds)

  function startChat() {
    setComposeError(null)
    const peer = decodePubkey(composeValue)
    if (!peer) {
      setComposeError('Enter a valid npub or hex pubkey')
      return
    }
    if (pubkey && peer === pubkey) {
      setComposeError("You can't message yourself")
      return
    }
    setComposeOpen(false)
    setComposeValue('')
    navigate(`/messages/${hexToNpub(peer)}`)
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
        <div className="flex h-12 items-center justify-between px-2">
          <h1 className="px-2 text-lg font-bold tracking-wide">Messages</h1>
          <button
            type="button"
            onClick={() => setComposeOpen((v) => !v)}
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-zinc-100 active:bg-zinc-800"
            aria-label="New message"
          >
            <Plus className="h-6 w-6" strokeWidth={1.75} />
          </button>
        </div>

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

      {composeOpen && (
        <div className="space-y-2 border-b border-zinc-800 px-3 py-3">
          <p className="text-xs text-zinc-500">
            Message someone by npub or hex pubkey
          </p>
          <div className="flex gap-2">
            <input
              value={composeValue}
              onChange={(e) => setComposeValue(e.target.value)}
              placeholder="npub1… or hex"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-11 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm outline-none"
            />
            <button
              type="button"
              onClick={startChat}
              className="min-h-11 touch-manipulation rounded-xl bg-white px-4 text-sm font-semibold text-zinc-900"
            >
              Chat
            </button>
          </div>
          {composeError && (
            <p className="text-xs text-amber-400">{composeError}</p>
          )}
        </div>
      )}

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

      {inbox.threads.length === 0 && !inbox.loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <MessageCircle className="h-8 w-8 text-zinc-600" />
          <p className="text-sm text-zinc-400">
            {folder === 'primary'
              ? 'No primary chats yet. Message people you follow, or accept a request.'
              : 'No message requests. DMs from people you don’t follow show up here.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-900">
          {inbox.threads.map((thread) => {
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
