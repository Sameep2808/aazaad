import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { db } from '../lib/db'

vi.mock('../lib/nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/nostr')>()
  return {
    ...actual,
    publishEvent: vi.fn().mockResolvedValue([]),
  }
})

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

describe('AuthContext password accounts', () => {
  beforeEach(async () => {
    sessionStorage.clear()
    delete window.nostr
    await db.accounts.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
    delete window.nostr
  })

  it('creates an account with username/password and signs events', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.createAccount('dave', 'password123')
    })

    expect(result.current.method).toBe('password')
    expect(result.current.username).toBe('dave')
    expect(result.current.pubkey).toHaveLength(64)

    const signed = await result.current.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'hi',
    })
    expect(signed.pubkey).toBe(result.current.pubkey)
  })

  it('logs in with username/password after logout', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.createAccount('erin', 'password123')
    })
    const pubkey = result.current.pubkey

    await act(async () => {
      result.current.logout()
    })
    expect(result.current.pubkey).toBeNull()

    await act(async () => {
      await result.current.loginWithPassword('erin', 'password123')
    })
    expect(result.current.pubkey).toBe(pubkey)
    expect(result.current.username).toBe('erin')
  })

  it('still supports NIP-07 extension login', async () => {
    const mockPubkey = 'c'.repeat(64)
    window.nostr = {
      getPublicKey: vi.fn().mockResolvedValue(mockPubkey),
      signEvent: vi.fn().mockImplementation(async (evt) => ({
        ...evt,
        id: 'd'.repeat(64),
        pubkey: mockPubkey,
        sig: 'e'.repeat(128),
      })),
    }

    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.loginWithExtension()
    })

    expect(result.current.method).toBe('nip07')
    expect(result.current.pubkey).toBe(mockPubkey)
  })
})
