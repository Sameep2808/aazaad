import Dexie, { type Table } from 'dexie'

export interface FollowCacheRow {
  pubkey: string
  following: string[]
  updatedAt: number
}

export interface SeededCidRow {
  cid: string
  pinnedAt: number
}

/** Local password-protected Nostr account (private key encrypted with NIP-49). */
export interface AccountRow {
  username: string
  pubkey: string
  /** NIP-49 ncryptsec string */
  encryptedNsec: string
  createdAt: number
  updatedAt: number
}

export interface ProfileStatsCacheRow {
  pubkey: string
  following: string[]
  followers: string[]
  postCount: number
  updatedAt: number
}

/** Locally cached media posts (for instant Home/Profile visibility). */
export interface CachedPostRow {
  id: string
  pubkey: string
  createdAt: number
  cid: string
  mediaType: 'image' | 'video' | 'unknown'
  mimeType: string | null
  caption: string
  eventJson: string
  likes: number
  comments: number
  updatedAt: number
}

/** Cached Nostr Kind 0 profile metadata */
export interface ProfileRow {
  pubkey: string
  username: string | null
  displayName: string | null
  picture: string | null
  pictureCid: string | null
  updatedAt: number
}

/** Cached Kind 6 repost events */
export interface CachedRepostRow {
  id: string
  reposterPubkey: string
  originalEventId: string
  originalPubkey: string
  createdAt: number
  eventJson: string
  /** Stringified original event when known */
  originalEventJson: string | null
  /** 1 = active repost, 0 = unreposted (NIP-09 deleted) */
  active: number
  updatedAt: number
}

/** Current user's Kind 7 likes (one per post). */
export interface MyLikeRow {
  /** `${pubkey}:${postId}` */
  key: string
  pubkey: string
  postId: string
  likeEventId: string
  /** 1 = liked, 0 = unliked */
  active: number
  updatedAt: number
}

class AazaadDB extends Dexie {
  follows!: Table<FollowCacheRow, string>
  seeds!: Table<SeededCidRow, string>
  accounts!: Table<AccountRow, string>
  profileStats!: Table<ProfileStatsCacheRow, string>
  posts!: Table<CachedPostRow, string>
  profiles!: Table<ProfileRow, string>
  reposts!: Table<CachedRepostRow, string>
  myLikes!: Table<MyLikeRow, string>

  constructor() {
    super('aazaad')
    this.version(1).stores({
      follows: 'pubkey, updatedAt',
      seeds: 'cid, pinnedAt',
    })
    this.version(2).stores({
      follows: 'pubkey, updatedAt',
      seeds: 'cid, pinnedAt',
      accounts: 'username, pubkey, createdAt',
      profileStats: 'pubkey, updatedAt',
    })
    this.version(3).stores({
      follows: 'pubkey, updatedAt',
      seeds: 'cid, pinnedAt',
      accounts: 'username, pubkey, createdAt',
      profileStats: 'pubkey, updatedAt',
      posts: 'id, pubkey, createdAt, cid, updatedAt',
    })
    this.version(4)
      .stores({
        follows: 'pubkey, updatedAt',
        seeds: 'cid, pinnedAt',
        accounts: 'username, pubkey, createdAt',
        profileStats: 'pubkey, updatedAt',
        posts: 'id, pubkey, createdAt, cid, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('posts')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (typeof row.likes !== 'number') row.likes = 0
            if (typeof row.comments !== 'number') row.comments = 0
          })
      })
    this.version(5).stores({
      follows: 'pubkey, updatedAt',
      seeds: 'cid, pinnedAt',
      accounts: 'username, pubkey, createdAt',
      profileStats: 'pubkey, updatedAt',
      posts: 'id, pubkey, createdAt, cid, updatedAt',
      profiles: 'pubkey, updatedAt',
    })
    this.version(6).stores({
      follows: 'pubkey, updatedAt',
      seeds: 'cid, pinnedAt',
      accounts: 'username, pubkey, createdAt',
      profileStats: 'pubkey, updatedAt',
      posts: 'id, pubkey, createdAt, cid, updatedAt',
      profiles: 'pubkey, updatedAt',
      reposts: 'id, reposterPubkey, originalEventId, createdAt, updatedAt',
    })
    this.version(7)
      .stores({
        follows: 'pubkey, updatedAt',
        seeds: 'cid, pinnedAt',
        accounts: 'username, pubkey, createdAt',
        profileStats: 'pubkey, updatedAt',
        posts: 'id, pubkey, createdAt, cid, updatedAt',
        profiles: 'pubkey, updatedAt',
        reposts: 'id, reposterPubkey, originalEventId, createdAt, updatedAt',
        myLikes: 'key, pubkey, postId, active, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('reposts')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (typeof row.active !== 'number') row.active = 1
          })
      })
    this.version(8).stores({
      follows: 'pubkey, updatedAt',
      seeds: 'cid, pinnedAt',
      accounts: 'username, pubkey, createdAt',
      profileStats: 'pubkey, updatedAt',
      posts: 'id, pubkey, createdAt, cid, updatedAt',
      profiles: 'pubkey, username, updatedAt',
      reposts: 'id, reposterPubkey, originalEventId, createdAt, updatedAt',
      myLikes: 'key, pubkey, postId, active, updatedAt',
    })
  }
}

export const db = new AazaadDB()
