import { describe, expect, test, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createAppRoleTestDb, createTestDb } from '../helpers/db.js'

describe('migration 0003 — roles + RLS topology', () => {
  const adminDb = createTestDb()
  const appDb = createAppRoleTestDb()
  afterAll(async () => {
    await adminDb.destroy()
    await appDb.destroy()
  })

  test('argus_app role exists and is non-superuser, non-bypassrls', async () => {
    const row = await sql<{
      rolname: string
      rolsuper: boolean
      rolbypassrls: boolean
      rolcanlogin: boolean
    }>`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
      FROM pg_roles WHERE rolname = 'argus_app'
    `.execute(adminDb)
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].rolsuper).toBe(false)
    expect(row.rows[0].rolbypassrls).toBe(false)
    expect(row.rows[0].rolcanlogin).toBe(true)
  })

  test('argus_app can connect and SELECT on a non-RLS table (users)', async () => {
    const rows = await appDb.selectFrom('users').selectAll().execute()
    // Should at least see the seeded local user from migration 0002.
    expect(rows.length).toBeGreaterThan(0)
  })

  test('RLS is enabled and forced on tenant tables', async () => {
    const rows = await sql<{
      relname: string
      relrowsecurity: boolean
      relforcerowsecurity: boolean
    }>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('projects', 'sessions', 'steps', 'step_events', 'audit_log')
    `.execute(adminDb)
    for (const r of rows.rows) {
      expect(r.relrowsecurity, `${r.relname} should have RLS enabled`).toBe(true)
      expect(r.relforcerowsecurity, `${r.relname} should have RLS forced`).toBe(true)
    }
  })

  test('tenant_isolation policy exists on each RLS table', async () => {
    const rows = await sql<{ tablename: string; policyname: string }>`
      SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
    `.execute(adminDb)
    const byTable = Object.fromEntries(rows.rows.map((r) => [r.tablename, r.policyname]))
    expect(byTable.projects).toBe('tenant_isolation')
    expect(byTable.sessions).toBe('tenant_isolation')
    expect(byTable.steps).toBe('tenant_isolation')
    expect(byTable.step_events).toBe('tenant_isolation')
    expect(byTable.audit_log).toBe('tenant_isolation')
  })
})
