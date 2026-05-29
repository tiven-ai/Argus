import type { Transaction } from 'kysely'
import type { DB } from '../../db/schema.js'

/**
 * Alias for the Kysely transaction type bound to our DB schema. Every DAO that
 * touches a tenant table accepts this in M7+.
 */
export type Tx = Transaction<DB>
