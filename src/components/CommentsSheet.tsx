import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, X } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { usePostComments } from '../hooks/usePostComments'
import { useProfiles } from '../hooks/useProfiles'
import { displayHandle } from '../lib/profiles'
import { profilePath } from '../lib/userSearch'
import type { FeedPost } from '../lib/posts'
import { UserAvatar } from './UserAvatar'

interface CommentsSheetProps {
  post: FeedPost
  open: boolean
  onClose: () => void
  busy?: boolean
  error?: string | null
  onSubmit: (text: string) => Promise<Event | null>
}

function formatCommentTime(createdAtSec: number): string {
  const diff = Math.max(0, Date.now() / 1000 - createdAtSec)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d`
  return new Date(createdAtSec * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export function CommentsSheet({
  post,
  open,
  onClose,
  busy = false,
  error = null,
  onSubmit,
}: CommentsSheetProps) {
  const {
    comments,
    loading,
    error: loadError,
    prepend,
    toggleLike,
    likeBusyId,
  } = usePostComments(post.id, open)
  const [text, setText] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const authorKeys = useMemo(
    () => comments.map((c) => c.pubkey),
    [comments],
  )
  const { get: getProfile } = useProfiles(authorKeys)

  useEffect(() => {
    if (!open) {
      setText('')
      setLocalError(null)
      return
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
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

  async function handleSubmit() {
    setLocalError(null)
    const signed = await onSubmit(text)
    if (signed) {
      prepend(signed)
      setText('')
    }
  }

  const displayError = localError || error || loadError

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close comments"
        onClick={onClose}
      />
      <div
        className="relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Comments"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Comments</h2>
            <p className="text-[11px] text-zinc-500">Top comments first</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 active:bg-zinc-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={listRef}
          className="min-h-[40dvh] flex-1 overflow-y-auto overscroll-contain"
        >
          {loading && comments.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">
              Loading comments…
            </p>
          ) : comments.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">
              No comments yet. Be the first.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-900/80 py-1">
              {comments.map((item) => {
                const profile = getProfile(item.pubkey)
                const stub = {
                  pubkey: item.pubkey,
                  username: null,
                  displayName: null,
                  pictureUrl: null,
                  pictureCid: null,
                }
                return (
                  <li key={item.id} className="flex gap-3 px-4 py-3">
                    <Link
                      to={profilePath(item.pubkey)}
                      onClick={onClose}
                      className="shrink-0 active:opacity-80"
                    >
                      <UserAvatar profile={profile ?? stub} size="md" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <Link
                          to={profilePath(item.pubkey)}
                          onClick={onClose}
                          className="truncate text-sm font-semibold text-zinc-100 active:opacity-80"
                        >
                          {displayHandle(profile ?? stub)}
                        </Link>
                        <span className="text-[11px] text-zinc-500">
                          {formatCommentTime(item.createdAt)}
                        </span>
                      </div>
                      <p className="allow-select mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
                        {item.content}
                      </p>
                      <button
                        type="button"
                        disabled={likeBusyId === item.id}
                        onClick={() => void toggleLike(item)}
                        className={[
                          'mt-2 flex min-h-9 items-center gap-1.5 text-xs active:opacity-70 disabled:opacity-50',
                          item.likedByMe ? 'text-red-400' : 'text-zinc-400',
                        ].join(' ')}
                        aria-pressed={item.likedByMe}
                        aria-label={item.likedByMe ? 'Unlike comment' : 'Like comment'}
                      >
                        <Heart
                          className="h-4 w-4"
                          fill={item.likedByMe ? 'currentColor' : 'none'}
                        />
                        {item.likes > 0 ? item.likes : 'Like'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {displayError && (
          <p className="border-t border-zinc-900 px-4 py-2 text-sm text-amber-400">
            {displayError}
          </p>
        )}

        <div className="flex gap-2 border-t border-zinc-800 px-3 py-3">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder="Add a comment…"
            disabled={busy}
            className="min-h-11 flex-1 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void handleSubmit()}
            className="min-h-11 touch-manipulation rounded-full bg-white px-4 text-xs font-semibold text-zinc-900 disabled:opacity-40"
          >
            {busy ? '…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
