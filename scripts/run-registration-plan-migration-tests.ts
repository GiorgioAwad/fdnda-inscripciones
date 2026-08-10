import "dotenv/config"
import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { Pool } from "pg"

const sourceUrl = process.env.DATABASE_URL
if (!sourceUrl) {
  throw new Error("DATABASE_URL es obligatorio para crear las bases aisladas.")
}

const source = new URL(sourceUrl)
if (source.protocol !== "postgresql:" && source.protocol !== "postgres:") {
  throw new Error("La suite de migracion solo admite PostgreSQL.")
}

const administrationUrl = new URL(source)
administrationUrl.pathname = "/postgres"
administrationUrl.searchParams.delete("schema")

const administrationPool = new Pool({
  connectionString: administrationUrl.toString(),
  max: 1,
})

const registrationPlanMigration = "20260803230000_registration_plans"

function databaseUrlFor(databaseName: string) {
  const url = new URL(source)
  url.pathname = `/${databaseName}`
  url.searchParams.delete("schema")
  return url.toString()
}

function testDatabaseName(scenario: "empty" | "historical") {
  const suffix = randomBytes(6).toString("hex")
  const name = `fdnda_migration_${scenario}_${suffix}`
  if (!/^fdnda_migration_(empty|historical)_[a-f0-9]{12}$/.test(name)) {
    throw new Error("Nombre de base de pruebas inesperado.")
  }
  return name
}

function run(
  databaseUrl: string,
  command: string,
  args: string[],
  extraEnvironment: Record<string, string | undefined> = {}
) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnvironment,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
    },
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} termino con codigo ${result.status ?? "desconocido"}.`)
  }
}

function runPrisma(databaseUrl: string, args: string[]) {
  run(databaseUrl, process.execPath, [
    resolve("node_modules/prisma/build/index.js"),
    ...args,
  ])
}

function runVitest(
  databaseUrl: string,
  scenario: "empty" | "historical"
) {
  run(
    databaseUrl,
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "vitest.migration.config.mts",
    ],
    { BACKFILL_TEST_SCENARIO: scenario }
  )
}

async function seedHistoricalFixture(databaseUrl: string) {
  const fixturePool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    await fixturePool.query(`
      INSERT INTO "clubs" (
        "id", "name", "code", "createdAt", "updatedAt"
      ) VALUES (
        'legacy-club', 'Club historico', 'HIST',
        '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z'
      );

      INSERT INTO "users" (
        "id", "username", "name", "passwordHash", "role", "clubId",
        "createdAt", "updatedAt"
      ) VALUES (
        'legacy-user', 'delegado-historico', 'Delegado historico',
        'fixture-only', 'CLUB', 'legacy-club',
        '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z'
      );

      INSERT INTO "seasons" (
        "id", "year", "name", "startDate", "endDate", "isCurrent",
        "createdAt", "updatedAt"
      ) VALUES (
        'legacy-season', 2026, 'Temporada 2026', '2026-01-01', '2026-12-31',
        true, '2025-12-01T10:00:00.000Z', '2025-12-01T10:00:00.000Z'
      );

      INSERT INTO "events" (
        "id", "name", "slug", "disciplines", "startDate", "endDate",
        "registrationDeadline", "status", "createdAt", "updatedAt"
      ) VALUES
        (
          'legacy-event-one', 'Copa historica uno', 'copa-historica-uno',
          ARRAY['DIVING']::"Discipline"[], '2026-06-10', '2026-06-12',
          '2026-06-01T23:59:00.000Z', 'CLOSED',
          '2025-12-10T10:00:00.000Z', '2025-12-10T10:00:00.000Z'
        ),
        (
          'legacy-event-two', 'Copa historica dos', 'copa-historica-dos',
          ARRAY['DIVING']::"Discipline"[], '2026-08-20', '2026-08-21',
          '2026-08-01T23:59:00.000Z', 'CLOSED',
          '2025-12-11T10:00:00.000Z', '2025-12-11T10:00:00.000Z'
        );

      INSERT INTO "event_modalities" (
        "id", "eventId", "discipline", "name", "sexRule", "minAthletes",
        "maxAthletes", "price", "sortOrder", "isActive",
        "allowsCategoryUpgrade", "createdAt", "updatedAt"
      ) VALUES
        (
          'legacy-modality-single', 'legacy-event-one', 'DIVING',
          'Trampolin individual', 'ANY', 1, 1, 123.45, 1, true, false,
          '2025-12-10T10:00:00.000Z', '2025-12-10T10:00:00.000Z'
        ),
        (
          'legacy-modality-mixed-a', 'legacy-event-one', 'DIVING',
          'Plataforma evento uno', 'ANY', 1, 1, 80.00, 2, true, false,
          '2025-12-10T10:00:00.000Z', '2025-12-10T10:00:00.000Z'
        ),
        (
          'legacy-modality-mixed-b', 'legacy-event-two', 'DIVING',
          'Plataforma evento dos', 'ANY', 1, 1, 120.00, 1, true, false,
          '2025-12-11T10:00:00.000Z', '2025-12-11T10:00:00.000Z'
        ),
        (
          'legacy-modality-pending-a', 'legacy-event-one', 'DIVING',
          'Pendiente uno', 'ANY', 1, 1, 50.00, 3, true, false,
          '2025-12-10T10:00:00.000Z', '2025-12-10T10:00:00.000Z'
        ),
        (
          'legacy-modality-pending-b', 'legacy-event-one', 'DIVING',
          'Pendiente dos', 'ANY', 1, 1, 60.00, 4, true, false,
          '2025-12-10T10:00:00.000Z', '2025-12-10T10:00:00.000Z'
        ),
        (
          'legacy-modality-cart', 'legacy-event-one', 'DIVING',
          'Borrador sin orden', 'ANY', 1, 1, 70.00, 5, true, false,
          '2025-12-10T10:00:00.000Z', '2025-12-10T10:00:00.000Z'
        );

      INSERT INTO "athletes" (
        "id", "firstNames", "lastNames", "docNumber", "birthDate", "sex",
        "clubId", "disciplines", "createdAt", "updatedAt"
      ) VALUES
        (
          'legacy-athlete-single', 'Ada', 'Historica', 'LEG-001', '2011-04-02',
          'F', 'legacy-club', ARRAY['DIVING']::"Discipline"[],
          '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z'
        ),
        (
          'legacy-athlete-mixed-a', 'Bea', 'Legado', 'LEG-002', '2010-03-01',
          'F', 'legacy-club', ARRAY['DIVING']::"Discipline"[],
          '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z'
        ),
        (
          'legacy-athlete-mixed-b', 'Ciro', 'Legado', 'LEG-003', '2009-02-01',
          'M', 'legacy-club', ARRAY['DIVING']::"Discipline"[],
          '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z'
        ),
        (
          'legacy-athlete-pending-a', 'Dora', 'Pendiente', 'LEG-004', '2011-01-01',
          'F', 'legacy-club', ARRAY['DIVING']::"Discipline"[],
          '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z'
        ),
        (
          'legacy-athlete-pending-b', 'Enzo', 'Pendiente', 'LEG-005', '2010-01-01',
          'M', 'legacy-club', ARRAY['DIVING']::"Discipline"[],
          '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z'
        ),
        (
          'legacy-athlete-cart', 'Fina', 'Borrador', 'LEG-006', '2009-01-01',
          'F', 'legacy-club', ARRAY['DIVING']::"Discipline"[],
          '2025-01-01T10:00:00.000Z', '2025-01-01T10:00:00.000Z'
        );

      INSERT INTO "registrations" (
        "id", "modalityId", "clubId", "status", "activeOrderId",
        "createdAt", "updatedAt"
      ) VALUES
        (
          'legacy-registration-single', 'legacy-modality-single', 'legacy-club',
          'PAID', 'legacy-order-single',
          '2026-05-01T10:00:00.000Z', '2026-05-01T10:00:00.000Z'
        ),
        (
          'legacy-registration-mixed-a', 'legacy-modality-mixed-a', 'legacy-club',
          'PAID', 'legacy-order-mixed',
          '2026-05-02T10:00:00.000Z', '2026-05-02T10:00:00.000Z'
        ),
        (
          'legacy-registration-mixed-b', 'legacy-modality-mixed-b', 'legacy-club',
          'PAID', 'legacy-order-mixed',
          '2026-05-02T10:00:00.000Z', '2026-05-02T10:00:00.000Z'
        ),
        (
          'legacy-registration-pending-a', 'legacy-modality-pending-a', 'legacy-club',
          'PENDING_PAYMENT', 'legacy-order-pending-a',
          '2026-05-03T10:00:00.000Z', '2026-05-03T10:00:00.000Z'
        ),
        (
          'legacy-registration-pending-b', 'legacy-modality-pending-b', 'legacy-club',
          'PENDING_PAYMENT', 'legacy-order-pending-b',
          '2026-05-03T10:01:00.000Z', '2026-05-03T10:01:00.000Z'
        ),
        (
          'legacy-registration-cart', 'legacy-modality-cart', 'legacy-club',
          'IN_CART', NULL,
          '2026-05-03T10:02:00.000Z', '2026-05-03T10:02:00.000Z'
        );

      INSERT INTO "registration_athletes" (
        "id", "registrationId", "athleteId", "modalityId", "isReserve"
      ) VALUES
        (
          'legacy-ra-single', 'legacy-registration-single',
          'legacy-athlete-single', 'legacy-modality-single', false
        ),
        (
          'legacy-ra-mixed-a', 'legacy-registration-mixed-a',
          'legacy-athlete-mixed-a', 'legacy-modality-mixed-a', false
        ),
        (
          'legacy-ra-mixed-b', 'legacy-registration-mixed-b',
          'legacy-athlete-mixed-b', 'legacy-modality-mixed-b', true
        ),
        (
          'legacy-ra-pending-a', 'legacy-registration-pending-a',
          'legacy-athlete-pending-a', 'legacy-modality-pending-a', false
        ),
        (
          'legacy-ra-pending-b', 'legacy-registration-pending-b',
          'legacy-athlete-pending-b', 'legacy-modality-pending-b', false
        ),
        (
          'legacy-ra-cart', 'legacy-registration-cart',
          'legacy-athlete-cart', 'legacy-modality-cart', false
        );

      INSERT INTO "orders" (
        "id", "code", "clubId", "userId", "kind", "totalAmount", "currency",
        "status", "provider", "providerOrderNumber", "providerTransactionId",
        "providerRef", "providerResponse", "paidAt", "expiresAt",
        "createdAt", "updatedAt"
      ) VALUES
        (
          'legacy-order-single', 'LEGACY-SINGLE-001', 'legacy-club', 'legacy-user',
          'REGISTRATION', 123.45, 'PEN', 'PAID', 'IZIPAY', '981234567',
          'TX-REG-001', 'REF-SINGLE-001',
          '{"code":"00","message":"AUTORIZADO","audit":"single-original"}'::jsonb,
          '2026-05-01T10:05:00.000Z', '2026-05-01T10:20:00.000Z',
          '2026-05-01T10:00:00.000Z', '2026-05-01T10:05:00.000Z'
        ),
        (
          'legacy-order-mixed', 'LEGACY-MIXED-001', 'legacy-club', 'legacy-user',
          'REGISTRATION', 200.00, 'PEN', 'PAID', 'IZIPAY', '981234568',
          'TX-REG-002', 'REF-MIXED-001',
          '{"code":"00","message":"AUTORIZADO","audit":"mixed-original"}'::jsonb,
          '2026-05-02T10:05:00.000Z', '2026-05-02T10:20:00.000Z',
          '2026-05-02T10:00:00.000Z', '2026-05-02T10:05:00.000Z'
        ),
        (
          'legacy-order-pending-a', 'LEGACY-PENDING-001', 'legacy-club', 'legacy-user',
          'REGISTRATION', 50.00, 'PEN', 'PENDING', 'IZIPAY', '981234569',
          NULL, 'REF-PENDING-001',
          '{"state":"CREATED","audit":"pending-a-original"}'::jsonb,
          NULL, '2026-05-03T10:20:00.000Z',
          '2026-05-03T10:00:00.000Z', '2026-05-03T10:00:00.000Z'
        ),
        (
          'legacy-order-pending-b', 'LEGACY-PENDING-002', 'legacy-club', 'legacy-user',
          'REGISTRATION', 60.00, 'PEN', 'PENDING', 'IZIPAY', '981234570',
          NULL, 'REF-PENDING-002',
          '{"state":"CREATED","audit":"pending-b-original"}'::jsonb,
          NULL, '2026-05-03T10:21:00.000Z',
          '2026-05-03T10:01:00.000Z', '2026-05-03T10:01:00.000Z'
        );

      INSERT INTO "order_items" (
        "id", "orderId", "registrationId", "description", "unitPrice"
      ) VALUES
        (
          'legacy-item-single', 'legacy-order-single',
          'legacy-registration-single', 'Inscripcion historica individual', 123.45
        ),
        (
          'legacy-item-mixed-a', 'legacy-order-mixed',
          'legacy-registration-mixed-a', 'Inscripcion historica evento uno', 80.00
        ),
        (
          'legacy-item-mixed-b', 'legacy-order-mixed',
          'legacy-registration-mixed-b', 'Inscripcion historica evento dos', 120.00
        ),
        (
          'legacy-item-pending-a', 'legacy-order-pending-a',
          'legacy-registration-pending-a', 'Inscripcion pendiente uno', 50.00
        ),
        (
          'legacy-item-pending-b', 'legacy-order-pending-b',
          'legacy-registration-pending-b', 'Inscripcion pendiente dos', 60.00
        );
    `)
  } finally {
    await fixturePool.end()
  }
}

async function createDatabase(databaseName: string) {
  await administrationPool.query(`CREATE DATABASE "${databaseName}"`)
}

async function dropDatabase(databaseName: string) {
  await administrationPool.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName]
  )
  await administrationPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
}

async function testEmptyDatabase() {
  const databaseName = testDatabaseName("empty")
  const databaseUrl = databaseUrlFor(databaseName)
  await createDatabase(databaseName)
  try {
    runPrisma(databaseUrl, ["migrate", "deploy"])
    runVitest(databaseUrl, "empty")
  } finally {
    await dropDatabase(databaseName)
  }
}

async function testHistoricalDatabase() {
  const databaseName = testDatabaseName("historical")
  const databaseUrl = databaseUrlFor(databaseName)
  await createDatabase(databaseName)
  try {
    const migrationDirectories = readdirSync(resolve("prisma/migrations"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    for (const migration of migrationDirectories.filter(
      (name) => name < registrationPlanMigration
    )) {
      runPrisma(databaseUrl, [
        "db",
        "execute",
        "--file",
        resolve(`prisma/migrations/${migration}/migration.sql`),
      ])
    }

    await seedHistoricalFixture(databaseUrl)
    for (const migration of migrationDirectories.filter(
      (name) => name >= registrationPlanMigration
    )) {
      runPrisma(databaseUrl, [
        "db",
        "execute",
        "--file",
        resolve(`prisma/migrations/${migration}/migration.sql`),
      ])
    }
    runVitest(databaseUrl, "historical")
  } finally {
    await dropDatabase(databaseName)
  }
}

async function main() {
  await testEmptyDatabase()
  await testHistoricalDatabase()
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await administrationPool.end()
  })
