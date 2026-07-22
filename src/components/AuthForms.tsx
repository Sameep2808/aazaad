import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'

type AuthTab = 'login' | 'signup'

export function AuthForms() {
  const {
    createAccount,
    loginWithPassword,
    loginWithExtension,
    loginEphemeral,
    hasExtension,
    localAccounts,
  } = useAuth()

  const [tab, setTab] = useState<AuthTab>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (tab === 'signup') {
        if (password !== confirm) {
          throw new Error('Passwords do not match')
        }
        await createAccount(username, password)
      } else {
        await loginWithPassword(username, password)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex rounded-lg border border-zinc-800 p-1">
        <button
          type="button"
          onClick={() => {
            setTab('login')
            setError(null)
          }}
          className={[
            'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
            tab === 'login' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400',
          ].join(' ')}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('signup')
            setError(null)
          }}
          className={[
            'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
            tab === 'signup' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400',
          ].join(' ')}
        >
          Create account
        </button>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-zinc-400">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="your_name"
            required
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-zinc-500 placeholder:text-zinc-600 focus:ring-1"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-zinc-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            placeholder="••••••••"
            required
            minLength={8}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-zinc-500 placeholder:text-zinc-600 focus:ring-1"
          />
        </label>

        {tab === 'signup' && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-zinc-400">Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              required
              minLength={8}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-zinc-500 placeholder:text-zinc-600 focus:ring-1"
            />
          </label>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-zinc-900 disabled:opacity-50"
        >
          {busy ? 'Please wait…' : tab === 'signup' ? 'Create account' : 'Log in'}
        </button>
      </form>

      {tab === 'login' && localAccounts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">Accounts on this device</p>
          <ul className="flex flex-wrap gap-2">
            {localAccounts.map((acc) => (
              <li key={acc.username}>
                <button
                  type="button"
                  onClick={() => setUsername(acc.username)}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                >
                  @{acc.username}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-center text-[11px] leading-relaxed text-zinc-500">
        Accounts are stored on this device only. Your password encrypts your Nostr
        private key (NIP-49) — there is no central server.
      </p>

      <div className="relative py-1 text-center text-[10px] uppercase tracking-wider text-zinc-600">
        <span className="bg-zinc-950 px-2">or</span>
        <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-zinc-800" />
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={!hasExtension}
          onClick={() => void loginWithExtension().catch((err: Error) => setError(err.message))}
          className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-200 disabled:opacity-40"
        >
          {hasExtension ? 'Continue with Nostr extension' : 'No Nostr extension detected'}
        </button>
        <button
          type="button"
          onClick={() => void loginEphemeral().catch((err: Error) => setError(err.message))}
          className="rounded-lg border border-zinc-800 px-4 py-2.5 text-xs text-zinc-500"
        >
          Guest (ephemeral key)
        </button>
      </div>
    </div>
  )
}
