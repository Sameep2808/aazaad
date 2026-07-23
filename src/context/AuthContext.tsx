import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Event, EventTemplate } from 'nostr-tools'
import {
  createEphemeralIdentity,
  decodeNsec,
  hexToNpub,
  pubkeyFromSecretKey,
  secretKeyToHex,
  signWithSecretKey,
} from '../lib/nostr'
import * as nip04 from 'nostr-tools/nip04'
import {
  createAccount as createLocalAccount,
  loginWithPassword as unlockLocalAccount,
  listAccounts,
} from '../lib/accounts'
import { deleteAccountAndContent } from '../lib/deletions'
import type { AccountRow } from '../lib/db'

const SESSION_SK = 'aazaad:session-sk'
const SESSION_USER = 'aazaad:session-username'
const SESSION_METHOD = 'aazaad:session-method'

export type AuthMethod = 'password' | 'nip07' | 'ephemeral' | null

export interface AuthState {
  pubkey: string | null
  npub: string | null
  username: string | null
  method: AuthMethod
  ready: boolean
  hasExtension: boolean
  localAccounts: AccountRow[]
  createAccount: (username: string, password: string) => Promise<void>
  loginWithPassword: (username: string, password: string) => Promise<void>
  loginWithExtension: () => Promise<void>
  loginEphemeral: () => Promise<void>
  refreshAccounts: () => Promise<void>
  logout: () => void
  /** Delete account locally + NIP-09 delete all posts/reposts on relays */
  deleteAccount: () => Promise<void>
  signEvent: (template: EventTemplate) => Promise<Event>
  /** NIP-04 encrypt a DM for peer pubkey */
  encryptDm: (peerPubkey: string, plaintext: string) => Promise<string>
  /** NIP-04 decrypt a DM from peer pubkey */
  decryptDm: (peerPubkey: string, ciphertext: string) => Promise<string>
  /** True when we can send/receive encrypted DMs */
  canDm: boolean
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey: () => Promise<string>
      signEvent: (event: EventTemplate) => Promise<Event>
      nip04?: {
        encrypt: (pubkey: string, plaintext: string) => Promise<string>
        decrypt: (pubkey: string, ciphertext: string) => Promise<string>
      }
    }
  }
}

const AuthContext = createContext<AuthState | null>(null)

function loadSession(): {
  secretKey: Uint8Array | null
  username: string | null
  method: AuthMethod
} {
  try {
    const method = (sessionStorage.getItem(SESSION_METHOD) as AuthMethod) || null
    const username = sessionStorage.getItem(SESSION_USER)
    const hex = sessionStorage.getItem(SESSION_SK)
    if (method === 'nip07') {
      return { secretKey: null, username: null, method: 'nip07' }
    }
    if (!hex) return { secretKey: null, username: null, method: null }
    return {
      secretKey: decodeNsec(hex),
      username,
      method: method === 'password' || method === 'ephemeral' ? method : 'ephemeral',
    }
  } catch {
    return { secretKey: null, username: null, method: null }
  }
}

function persistSession(opts: {
  secretKey: Uint8Array | null
  username: string | null
  method: AuthMethod
  nip07Pubkey?: string | null
}) {
  if (!opts.method) {
    sessionStorage.removeItem(SESSION_SK)
    sessionStorage.removeItem(SESSION_USER)
    sessionStorage.removeItem(SESSION_METHOD)
    sessionStorage.removeItem('aazaad:nip07-pubkey')
    return
  }
  sessionStorage.setItem(SESSION_METHOD, opts.method)
  if (opts.username) {
    sessionStorage.setItem(SESSION_USER, opts.username)
  } else {
    sessionStorage.removeItem(SESSION_USER)
  }
  if (opts.secretKey) {
    sessionStorage.setItem(SESSION_SK, secretKeyToHex(opts.secretKey))
  } else {
    sessionStorage.removeItem(SESSION_SK)
  }
  if (opts.method === 'nip07' && opts.nip07Pubkey) {
    sessionStorage.setItem('aazaad:nip07-pubkey', opts.nip07Pubkey)
  } else {
    sessionStorage.removeItem('aazaad:nip07-pubkey')
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [pubkey, setPubkey] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [method, setMethod] = useState<AuthMethod>(null)
  const [secretKey, setSecretKey] = useState<Uint8Array | null>(null)
  const [ready, setReady] = useState(false)
  const [localAccounts, setLocalAccounts] = useState<AccountRow[]>([])

  const hasExtension =
    typeof window !== 'undefined' && typeof window.nostr?.getPublicKey === 'function'

  const refreshAccounts = useCallback(async () => {
    setLocalAccounts(await listAccounts())
  }, [])

  useEffect(() => {
    const session = loadSession()
    if (session.method === 'nip07') {
      const pk = sessionStorage.getItem('aazaad:nip07-pubkey')
      if (pk) {
        setPubkey(pk)
        setMethod('nip07')
      }
    } else if (session.secretKey) {
      setSecretKey(session.secretKey)
      setPubkey(pubkeyFromSecretKey(session.secretKey))
      setUsername(session.username)
      setMethod(session.method)
    }
    void refreshAccounts().finally(() => setReady(true))
  }, [refreshAccounts])

  const applyUnlocked = useCallback(
    (opts: {
      secretKey: Uint8Array
      pubkey: string
      username: string | null
      method: 'password' | 'ephemeral'
    }) => {
      persistSession({
        secretKey: opts.secretKey,
        username: opts.username,
        method: opts.method,
      })
      setSecretKey(opts.secretKey)
      setPubkey(opts.pubkey)
      setUsername(opts.username)
      setMethod(opts.method)
    },
    [],
  )

  const createAccount = useCallback(
    async (user: string, password: string) => {
      const account = await createLocalAccount(user, password)
      applyUnlocked({
        secretKey: account.secretKey,
        pubkey: account.pubkey,
        username: account.username,
        method: 'password',
      })
      await refreshAccounts()
    },
    [applyUnlocked, refreshAccounts],
  )

  const loginWithPassword = useCallback(
    async (user: string, password: string) => {
      const account = await unlockLocalAccount(user, password)
      applyUnlocked({
        secretKey: account.secretKey,
        pubkey: account.pubkey,
        username: account.username,
        method: 'password',
      })
    },
    [applyUnlocked],
  )

  const loginWithExtension = useCallback(async () => {
    if (!window.nostr?.getPublicKey) {
      throw new Error('No NIP-07 extension found (e.g. Alby, nos2x)')
    }
    const pk = await window.nostr.getPublicKey()
    persistSession({
      secretKey: null,
      username: null,
      method: 'nip07',
      nip07Pubkey: pk,
    })
    setSecretKey(null)
    setUsername(null)
    setPubkey(pk)
    setMethod('nip07')
  }, [])

  const loginEphemeral = useCallback(async () => {
    const identity = createEphemeralIdentity()
    applyUnlocked({
      secretKey: identity.secretKey,
      pubkey: identity.pubkey,
      username: null,
      method: 'ephemeral',
    })
  }, [applyUnlocked])

  const logout = useCallback(() => {
    persistSession({ secretKey: null, username: null, method: null })
    setSecretKey(null)
    setPubkey(null)
    setUsername(null)
    setMethod(null)
  }, [])

  const signEvent = useCallback(
    async (template: EventTemplate): Promise<Event> => {
      if (method === 'nip07') {
        if (!window.nostr?.signEvent) {
          throw new Error('NIP-07 extension unavailable for signing')
        }
        return window.nostr.signEvent(template)
      }
      if ((method === 'password' || method === 'ephemeral') && secretKey) {
        return signWithSecretKey(template, secretKey)
      }
      throw new Error('Not logged in')
    },
    [method, secretKey],
  )

  const deleteAccount = useCallback(async () => {
    if (!pubkey) throw new Error('Not logged in')
    await deleteAccountAndContent({ pubkey, signEvent })
    logout()
    await refreshAccounts()
  }, [pubkey, signEvent, logout, refreshAccounts])

  const encryptDm = useCallback(
    async (peerPubkey: string, plaintext: string): Promise<string> => {
      if (method === 'nip07') {
        if (!window.nostr?.nip04?.encrypt) {
          throw new Error('Extension does not support encrypted DMs (NIP-04)')
        }
        return window.nostr.nip04.encrypt(peerPubkey, plaintext)
      }
      if ((method === 'password' || method === 'ephemeral') && secretKey) {
        return nip04.encrypt(secretKey, peerPubkey, plaintext)
      }
      throw new Error('Log in to send messages')
    },
    [method, secretKey],
  )

  const decryptDm = useCallback(
    async (peerPubkey: string, ciphertext: string): Promise<string> => {
      if (method === 'nip07') {
        if (!window.nostr?.nip04?.decrypt) {
          throw new Error('Extension does not support encrypted DMs (NIP-04)')
        }
        return window.nostr.nip04.decrypt(peerPubkey, ciphertext)
      }
      if ((method === 'password' || method === 'ephemeral') && secretKey) {
        return nip04.decrypt(secretKey, peerPubkey, ciphertext)
      }
      throw new Error('Log in to read messages')
    },
    [method, secretKey],
  )

  const canDm =
    Boolean(pubkey) &&
    (Boolean(secretKey) ||
      (method === 'nip07' && typeof window !== 'undefined'))

  const value = useMemo<AuthState>(
    () => ({
      pubkey,
      npub: pubkey ? hexToNpub(pubkey) : null,
      username,
      method,
      ready,
      hasExtension,
      localAccounts,
      createAccount,
      loginWithPassword,
      loginWithExtension,
      loginEphemeral,
      refreshAccounts,
      logout,
      deleteAccount,
      signEvent,
      encryptDm,
      decryptDm,
      canDm,
    }),
    [
      pubkey,
      username,
      method,
      ready,
      hasExtension,
      localAccounts,
      createAccount,
      loginWithPassword,
      loginWithExtension,
      loginEphemeral,
      refreshAccounts,
      logout,
      deleteAccount,
      signEvent,
      encryptDm,
      decryptDm,
      canDm,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
