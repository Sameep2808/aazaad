import { Reels as ReelsView } from '../components/Reels'
import { useReels } from '../hooks/useReels'

export function Reels() {
  const { posts, loading, error, refresh } = useReels()

  return (
    <ReelsView
      posts={posts}
      loading={loading}
      error={error}
      onRefresh={() => void refresh()}
    />
  )
}
