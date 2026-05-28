import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createKysely } from '../../src/db/kysely.js'
import { createMigrator } from '../../src/db/migrator.js'

let container: StartedPostgreSqlContainer | null = null

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('argus_test')
    .withUsername('argus')
    .withPassword('argus')
    .start()

  const url = container.getConnectionUri()
  process.env.DATABASE_URL = url

  const db = createKysely(url)
  const migrator = createMigrator(db)
  const { error } = await migrator.migrateToLatest()
  await db.destroy()
  if (error) throw error
}

export async function teardown() {
  await container?.stop()
}
