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

class AazaadDB extends Dexie {
  follows!: Table<FollowCacheRow, string>
  seeds!: Table<SeededCidRow, string>
  accounts!: Table<AccountRow, string>
  profileStats!: Table<ProfileStatsCacheRow, string>

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
  }
}

export const db = new AazaadDB()
