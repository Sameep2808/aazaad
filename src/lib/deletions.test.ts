import { describe, it, expect, beforeEach, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { createAccount, loginWithPassword } from './accounts'
import { db } from './db'
import {
  deleteAccountAndContent,
  deleteOwnPost,
  filterOutDeletedPosts,
  ingestDeletionEvents,
  isEventDeleted,
  markEventsDeleted,
  parseDeletionTargets,
  wipeLocalUserData,
} from './deletions'
import { cachePostFromEvent } from './postCache'
import { buildDeletionEvent, buildTextEventTemplate } from './posts'

vi.mock('./nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nostr')>()
  return {
    ...actual,
    getPool: () => ({ querySync: vi.fn().mockResolvedValue([]) }),
    publishEvent: vi.fn().mockResolvedValue([]),
  }
})

vi.mock('./posts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./posts')>()
  return {
    ...actual,
    publishEvent: vi.fn().mockResolvedValue([]),
    fetchAuthorsMediaEventsPage: vi.fn().mockResolvedValue({
      events: [],
      nextUntil: null,
      exhausted: true,
      nextAuthorChunk: null,
      authorChunks: 0,
    }),
  }
})

describe('deletions', () => {
  beforeEach(async () => {
    await db.accounts.clear()
    await db.posts.clear()
    await db.deletedEvents.clear()
    await db.profiles.clear()
    await db.dmMessages.clear()
    await db.dmThreads.clear()
    await db.myLikes.clear()
    await db.reposts.clear()
    await db.follows.clear()
    await db.profileStats.clear()
    await db.dmBlocks.clear()
    await db.dmAccepted.clear()
  })

  it('tombstones deleted events and skips re-cache', async () => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const event = finalizeEvent(buildTextEventTemplate('hello world'), sk)
    await cachePostFromEvent(event)
    expect(await db.posts.get(event.id)).toBeTruthy()

    await markEventsDeleted([event.id], pubkey)
    expect(await isEventDeleted(event.id)).toBe(true)
    expect(await db.posts.get(event.id)).toBeUndefined()

    const again = await cachePostFromEvent(event)
    expect(again).toBeNull()
    expect(await db.posts.get(event.id)).toBeUndefined()
  })

  it('filters deleted posts from lists', async () => {
    await markEventsDeleted(['abc'], 'pk')
    const kept = await filterOutDeletedPosts([{ id: 'abc' }, { id: 'def' }])
    expect(kept.map((p) => p.id)).toEqual(['def'])
  })

  it('parses Kind 5 deletion targets from e tags', () => {
    const sk = generateSecretKey()
    const del = finalizeEvent(buildDeletionEvent(['id1', 'id2'], 'delete post'), sk)
    expect(parseDeletionTargets(del)).toEqual(['id1', 'id2'])
  })

  it('ingests remote Kind 5 deletions so followers hide deleted posts', async () => {
    const authorSk = generateSecretKey()
    const authorPubkey = getPublicKey(authorSk)
    const post = finalizeEvent(buildTextEventTemplate('gone'), authorSk)
    await cachePostFromEvent(post)
    expect(await db.posts.get(post.id)).toBeTruthy()

    const del = finalizeEvent(buildDeletionEvent([post.id], 'delete post'), authorSk)
    await ingestDeletionEvents([del])

    expect(await isEventDeleted(post.id)).toBe(true)
    expect(await db.posts.get(post.id)).toBeUndefined()
    const visible = await filterOutDeletedPosts([{ id: post.id, pubkey: authorPubkey }])
    expect(visible).toHaveLength(0)
  })

  it('deleteOwnPost signs a deletion and removes local cache', async () => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const event = finalizeEvent(buildTextEventTemplate('bye'), sk)
    await cachePostFromEvent(event)

    await deleteOwnPost({
      postId: event.id,
      pubkey,
      signEvent: async (template) => finalizeEvent(template, sk),
    })

    expect(await isEventDeleted(event.id)).toBe(true)
    expect(await db.posts.get(event.id)).toBeUndefined()
  })

  it('deleteAccountAndContent removes local account and posts', async () => {
    const created = await createAccount('deleteme', 'password123')
    const unlocked = await loginWithPassword('deleteme', 'password123')
    const sk = unlocked.secretKey

    const event = finalizeEvent(buildTextEventTemplate('my post'), sk)
    await cachePostFromEvent(event)
    await db.profiles.put({
      pubkey: created.pubkey,
      username: 'deleteme',
      displayName: 'deleteme',
      picture: null,
      pictureCid: null,
      updatedAt: Date.now(),
    })

    await deleteAccountAndContent({
      pubkey: created.pubkey,
      signEvent: async (template) => finalizeEvent(template, sk),
    })

    expect(await db.accounts.get('deleteme')).toBeUndefined()
    expect(await db.posts.get(event.id)).toBeUndefined()
    expect(await isEventDeleted(event.id)).toBe(true)
    expect(await db.profiles.get(created.pubkey)).toBeUndefined()
  })

  it('wipeLocalUserData clears dm ownership rows', async () => {
    const pubkey = 'a'.repeat(64)
    await db.dmThreads.put({
      key: `${pubkey}:peer`,
      ownerPubkey: pubkey,
      peerPubkey: 'b'.repeat(64),
      folder: 'primary',
      lastAt: Date.now(),
      lastPreview: 'hi',
      unread: 0,
      updatedAt: Date.now(),
    })
    await wipeLocalUserData(pubkey)
    expect(await db.dmThreads.count()).toBe(0)
  })
})
