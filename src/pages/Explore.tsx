import { PlusSquare, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSocialGraph } from '../hooks/useSocialGraph'
import { useUserSearch } from '../hooks/useUserSearch'
import { useExploreFeed } from '../hooks/useExploreFeed'
import { UserAvatar } from '../components/UserAvatar'
import { ExplorePostsGrid } from '../components/ExplorePostsGrid'
import { displayHandle } from '../lib/profiles'
import { hexToNpub } from '../lib/nostr'
import { profilePath } from '../lib/userSearch'

export function Explore() {
  const { pubkey, ready } = useAuth()
  const { query, setQuery, results, loading, error, searched } = useUserSearch()
  const { following, loading: followsLoading } = useSocialGraph(pubkey)
  const explore = useExploreFeed(pubkey, following)
  const searching = query.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 px-2 py-2 backdrop-blur-md"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-1">
          <Link
            to="/upload"
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full text-zinc-100 active:bg-zinc-800"
            aria-label="Create post"
          >
            <PlusSquare className="h-6 w-6" strokeWidth={1.75} />
          </Link>
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search users</span>
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
        </div>
      </div>

      <div className="flex flex-1 flex-col px-3 py-4">
        {searching ? (
          <>
            {loading && (
              <p className="px-1 text-sm text-zinc-500">Searching…</p>
            )}

            {error && <p className="px-1 text-sm text-amber-400">{error}</p>}

            {searched && !loading && results.length === 0 && (
              <p className="px-1 py-6 text-center text-sm text-zinc-500">
                No users found for “{query.trim()}”
              </p>
            )}

            {results.length > 0 && (
              <ul className="space-y-1">
                {results.map((user) => {
                  const npub = hexToNpub(user.pubkey)
                  return (
                    <li key={user.pubkey}>
                      <Link
                        to={profilePath(user.pubkey)}
                        className="flex min-h-14 touch-manipulation items-center gap-3 rounded-xl px-2 py-2.5 active:bg-zinc-900/90"
                      >
                        <UserAvatar profile={user} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-zinc-100">
                            {displayHandle(user)}
                          </p>
                          <p className="truncate font-mono text-[10px] text-zinc-500">
                            {npub}
                          </p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : !ready ? (
          <p className="py-10 text-center text-sm text-zinc-500">Loading…</p>
        ) : !pubkey ? (
          <div className="space-y-3 px-1 py-10 text-center">
            <p className="text-sm font-medium text-zinc-200">Explore aazaad</p>
            <p className="text-sm text-zinc-500">
              Log in to discover posts from people connected to who you follow.
            </p>
            <Link
              to="/profile"
              className="inline-block min-h-11 touch-manipulation rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900"
            >
              Go to Profile
            </Link>
          </div>
        ) : (
          <ExplorePostsGrid
            posts={explore.posts}
            loading={explore.loading || followsLoading}
            loadingMore={explore.loadingMore}
            hasMore={explore.hasMore}
            error={explore.error}
            onRefresh={() => void explore.refresh()}
            onLoadMore={() => void explore.loadMore()}
            onEngage={explore.applyEngagement}
            emptyMessage={
              following.length === 0
                ? 'Follow people first — Explore prioritizes mutuals, then discovery posts.'
                : 'No explore posts yet. Mutual follows appear first, then other discovery.'
            }
          />
        )}
      </div>
    </div>
  )
}
