import { FileMigrationProvider, Migrator } from 'kysely'
import type { Kysely } from 'kysely'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DB } from './schema.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export function createMigrator(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(dirname, 'migrations'),
    }),
  })
}
