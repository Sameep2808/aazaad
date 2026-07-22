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

class AazaadDB extends Dexie {
  follows!: Table<FollowCacheRow, string>
  seeds!: Table<SeededCidRow, string>
  accounts!: Table<AccountRow, string>
  profileStats!: Table<ProfileStatsCacheRow, string>
  posts!: Table<CachedPostRow, string>
  profiles!: Table<ProfileRow, string>

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
  }
}

export const db = new AazaadDB()
