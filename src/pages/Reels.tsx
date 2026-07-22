import { Reels as ReelsView } from '../components/Reels'
import { useAuth } from '../context/AuthContext'
import { useSocialGraph } from '../hooks/useSocialGraph'
import { useReels } from '../hooks/useReels'

export function Reels() {
  const { pubkey } = useAuth()
  const { following, loading: followsLoading } = useSocialGraph(pubkey)
  const { posts, loading, error, refresh, applyEngagement } = useReels(
    pubkey,
    following,
  )

  return (
    <ReelsView
      posts={posts}
      loading={loading || followsLoading}
      error={error}
      onRefresh={() => void refresh()}
      onEngage={applyEngagement}
    />
  )
}
