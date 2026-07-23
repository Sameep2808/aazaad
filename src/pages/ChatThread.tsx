import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ShieldBan } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDmChat } from '../hooks/useDmChat'
import { useProfiles } from '../hooks/useProfiles'
import { UserAvatar } from '../components/UserAvatar'
import { MessageContent } from '../components/MessageContent'
import { displayHandle } from '../lib/profiles'
import { decodePubkey, hexToNpub } from '../lib/nostr'
import { profilePath } from '../lib/userSearch'

export function ChatThread() {
  const { id = '' } = useParams<{ id: string }>()
  const peer = useMemo(() => decodePubkey(id), [id])
  const { pubkey, ready } = useAuth()
  const navigate = useNavigate()
  const chat = useDmChat(peer)
  const { get: getProfile } = useProfiles(peer ? [peer] : [])
  const [text, setText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat.messages.length])

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
        <p className="text-sm text-zinc-300">Log in to chat</p>
        <Link to="/profile" className="text-sm text-zinc-400 underline">
          Profile
        </Link>
      </div>
    )
  }

  if (!peer) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-zinc-300">Invalid user</p>
        <Link to="/messages" className="text-sm text-zinc-400 underline">
          Back to Messages
        </Link>
      </div>
    )
  }

  const profile = getProfile(peer)
  const handle = displayHandle(profile)

  async function onSend() {
    const draft = text.trim()
    if (!draft) return
    // Clear immediately so the next message can be typed right away
    setText('')
    const ok = await chat.send(draft)
    if (!ok) setText(draft)
  }

  async function onBlock() {
    await chat.block()
    setMenuOpen(false)
    navigate('/messages')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className="sticky top-0 z-30 flex items-center gap-1 border-b border-zinc-800 bg-zinc-950/95 px-1 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <Link
          to="/messages"
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-zinc-100 active:bg-zinc-800"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Link
          to={profilePath(peer)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2"
        >
          <UserAvatar profile={profile} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{handle}</p>
            <p className="truncate font-mono text-[9px] text-zinc-500">
              {hexToNpub(peer).slice(0, 16)}…
            </p>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-zinc-400 active:bg-zinc-800"
          aria-label="Chat options"
        >
          <ShieldBan className="h-5 w-5" />
        </button>
      </header>

      {menuOpen && (
        <div className="flex gap-2 border-b border-zinc-800 px-3 py-2">
          {chat.folder === 'request' && (
            <button
              type="button"
              onClick={() => {
                void chat.accept()
                setMenuOpen(false)
              }}
              className="min-h-10 flex-1 rounded-lg bg-white text-xs font-semibold text-zinc-900"
            >
              Accept request
            </button>
          )}
          <button
            type="button"
            onClick={() => void onBlock()}
            className="min-h-10 flex-1 rounded-lg border border-red-900/60 text-xs font-semibold text-red-400"
          >
            Block
          </button>
        </div>
      )}

      {chat.folder === 'request' && !chat.blocked && (
        <div className="border-b border-zinc-800 bg-zinc-900/50 px-3 py-2 text-center">
          <p className="text-xs text-zinc-400">
            Message request from someone you don’t follow.
          </p>
          <div className="mt-2 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => void chat.accept()}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => void onBlock()}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
            >
              Block
            </button>
          </div>
        </div>
      )}

      {chat.blocked ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-zinc-500">
          You blocked this user.
        </div>
      ) : (
        <div
          ref={listRef}
          className="scroll-touch flex-1 space-y-2 overflow-y-auto px-3 py-3"
        >
          {chat.messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              Say hello — messages are private between you two.
            </p>
          ) : (
            chat.messages.map((msg) => (
              <div
                key={msg.id}
                className={[
                  'flex',
                  msg.direction === 'out' ? 'justify-end' : 'justify-start',
                ].join(' ')}
              >
                <div
                  className={[
                    'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                    msg.direction === 'out'
                      ? 'rounded-br-md bg-sky-600 text-white'
                      : 'rounded-bl-md bg-zinc-800 text-zinc-100',
                    msg.id.startsWith('pending:') ? 'opacity-70' : '',
                  ].join(' ')}
                >
                  <p className="allow-select whitespace-pre-wrap break-words">
                    <MessageContent content={msg.content} />
                  </p>
                  <p
                    className={[
                      'mt-1 text-[9px]',
                      msg.direction === 'out'
                        ? 'text-sky-100/70'
                        : 'text-zinc-500',
                    ].join(' ')}
                  >
                    {msg.id.startsWith('pending:')
                      ? 'Sending…'
                      : new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {chat.error && (
        <p className="px-3 text-xs text-amber-400">{chat.error}</p>
      )}

      {!chat.blocked && (
        <div
          className="flex gap-2 border-t border-zinc-800 bg-zinc-950 px-2 py-2"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void onSend()
              }
            }}
            placeholder="Message…"
            autoComplete="off"
            className="min-h-11 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-4 text-sm outline-none"
          />
          <button
            type="button"
            disabled={!text.trim()}
            onClick={() => void onSend()}
            className="min-h-11 touch-manipulation rounded-full bg-white px-4 text-sm font-semibold text-zinc-900 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}
