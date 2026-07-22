import { useAuth } from '../context/AuthContext'
import { useHelia } from '../context/HeliaContext'
import { useProfileStats } from '../hooks/useProfileStats'
import { AuthForms } from '../components/AuthForms'
import { ProfileHeader } from '../components/ProfileHeader'

export function Profile() {
  const { pubkey, npub, username, ready, logout } = useAuth()
  const { ready: heliaReady, error: heliaError, retry } = useHelia()
  const stats = useProfileStats(pubkey)

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-6">
      {!pubkey ? (
        <>
          <section className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">aazaad</h1>
            <p className="text-sm text-zinc-400">
              Create an account or log in to start sharing.
            </p>
          </section>
          <AuthForms />
        </>
      ) : (
        <>
          <ProfileHeader
            username={username}
            npub={npub}
            postsCount={stats.postsCount}
            followersCount={stats.followersCount}
            followingCount={stats.followingCount}
            followers={stats.followers}
            following={stats.following}
            loading={stats.loading}
            onLogout={logout}
            onRefresh={() => void stats.refresh()}
          />
          {stats.error && (
            <p className="text-sm text-amber-400">{stats.error}</p>
          )}
        </>
      )}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-500">
        <div className="flex items-center justify-between gap-2">
          <span>IPFS</span>
          {heliaError ? (
            <button type="button" onClick={retry} className="text-red-400 underline">
              Retry
            </button>
          ) : (
            <span className={heliaReady ? 'text-emerald-400' : 'text-zinc-400'}>
              {heliaReady ? 'Ready' : 'Starting…'}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
