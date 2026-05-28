import { loadEnv } from '../env.js'
import { createKysely } from './kysely.js'
import { createMigrator } from './migrator.js'

async function main() {
  const env = loadEnv()
  const db = createKysely(env.DATABASE_URL)
  const migrator = createMigrator(db)

  const command = process.argv[2] ?? 'latest'
  const result =
    command === 'down' ? await migrator.migrateDown() : await migrator.migrateToLatest()

  for (const r of result.results ?? []) {
    console.log(`${r.status}: ${r.migrationName}`)
  }

  if (result.error) {
    console.error(result.error)
    await db.destroy()
    process.exit(1)
  }

  await db.destroy()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
