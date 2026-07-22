import { Link } from 'react-router-dom'
import { Feed } from '../components/Feed'
import { useAuth } from '../context/AuthContext'
import { useFeed } from '../hooks/useFeed'
import { useSocialGraph } from '../hooks/useSocialGraph'

export function Home() {
  const { pubkey, ready } = useAuth()
  const { following, loading: followsLoading } = useSocialGraph(pubkey)
  const { posts, loading, loadingMore, hasMore, error, refresh, loadMore, applyEngagement } =
    useFeed(pubkey, following)

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
        <p className="text-sm text-zinc-300">Log in to see your following feed</p>
        <p className="text-xs text-zinc-500">
          Home only shows your posts and posts from people you follow.
        </p>
        <Link
          to="/profile"
          className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900"
        >
          Go to Profile
        </Link>
      </div>
    )
  }

  return (
    <Feed
      posts={posts}
      loading={loading || followsLoading}
      loadingMore={loadingMore}
      hasMore={hasMore}
      error={error}
      onRefresh={() => void refresh()}
      onLoadMore={() => void loadMore()}
      onEngage={applyEngagement}
      emptyMessage={
        following.length === 0
          ? 'Only your posts appear until you follow people on Nostr.'
          : 'No posts from you or people you follow yet.'
      }
    />
  )
}
