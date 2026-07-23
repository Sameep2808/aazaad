import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PostCard } from '../components/Feed'
import { useProfiles } from '../hooks/useProfiles'
import { db } from '../lib/db'
import {
  fetchEventsByIds,
  parseFeedPost,
  type FeedPost,
} from '../lib/posts'
import { cachePostFromEvent, rowToFeedPost } from '../lib/postCache'
import { isEventDeleted, syncDeletionsForAuthors } from '../lib/deletions'

const EVENT_ID_RE = /^[0-9a-f]{64}$/i

export function PostDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const eventId = id.trim().toLowerCase()
  const valid = EVENT_ID_RE.test(eventId)
  const [post, setPost] = useState<FeedPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const authorKeys = post
    ? ([post.pubkey, post.repost?.pubkey].filter(Boolean) as string[])
    : []
  const { get: getProfile } = useProfiles(authorKeys)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!valid) {
        setPost(null)
        setLoading(false)
        setError('Invalid post id')
        return
      }
      setLoading(true)
      setError(null)
      try {
        if (await isEventDeleted(eventId)) {
          if (!cancelled) {
            setPost(null)
            setError('This post was deleted')
          }
          return
        }

        const cached = await db.posts.get(eventId)
        if (cached) {
          const fromCache = rowToFeedPost(cached)
          if (fromCache && !cancelled) setPost(fromCache)
        }

        const events = await fetchEventsByIds([eventId])
        const event = events[0]
        if (event) {
          await syncDeletionsForAuthors([event.pubkey])
          if (await isEventDeleted(eventId)) {
            if (!cancelled) {
              setPost(null)
              setError('This post was deleted')
            }
            return
          }

          const parsed = parseFeedPost(event)
          if (parsed) {
            await cachePostFromEvent(event)
            if (!cancelled) setPost(parsed)
          } else if (!cancelled && !cached) {
            setError('This event is not a supported aazaad post')
          }
        } else if (!cancelled && !cached) {
          setError('Post not found on relays')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load post')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [eventId, valid])

  return (
    <div className="flex flex-1 flex-col">
      <header
        className="sticky top-0 z-30 flex items-center gap-1 border-b border-zinc-800 bg-zinc-950/95 px-1 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <Link
          to="/"
          className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-zinc-100 active:bg-zinc-800"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-sm font-semibold text-zinc-100">Post</h1>
      </header>

      {loading && !post && (
        <p className="px-4 py-10 text-center text-sm text-zinc-500">Loading…</p>
      )}
      {error && !post && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <p className="text-sm text-zinc-300">{error}</p>
          <Link to="/" className="text-sm text-zinc-400 underline">
            Home
          </Link>
        </div>
      )}
      {post && (
        <PostCard
          post={post}
          profile={getProfile(post.pubkey)}
          reposterProfile={
            post.repost ? getProfile(post.repost.pubkey) : undefined
          }
          onChanged={() => {
            void (async () => {
              if (await isEventDeleted(post.id)) {
                setPost(null)
                setError('This post was deleted')
              }
            })()
          }}
        />
      )}
    </div>
  )
}
