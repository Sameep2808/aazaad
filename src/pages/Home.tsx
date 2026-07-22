import { Feed } from '../components/Feed'
import { useFeed } from '../hooks/useFeed'

export function Home() {
  const { posts, loading, error, refresh } = useFeed()

  return (
    <Feed
      posts={posts}
      loading={loading}
      error={error}
      onRefresh={() => void refresh()}
    />
  )
}
