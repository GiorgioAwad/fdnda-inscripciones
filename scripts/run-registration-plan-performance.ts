import "dotenv/config"

import { randomBytes } from "node:crypto"
import { cpus, freemem, platform, release, totalmem } from "node:os"
import { performance } from "node:perf_hooks"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { Pool } from "pg"

const ATHLETES_IN_SCALE_CLUB = 1_000
const MODALITY_COUNT = 300
const CONCURRENT_OPERATIONS = 100
const LOAD_AUTOSAVE_TARGET_MS = 2_000
const CHECKOUT_TARGET_MS = 3_000
const WORKER_FLAG = "--isolated-worker"

type ActionResult = {
  success: boolean
  error?: string
  code?: string
  revision?: number
}

type PlanFixture = {
  clubId: string
  userId: string
  primaryAthleteId: string
  secondaryAthleteId: string
  planId: string
  revision: number
}

type BatchMetrics = {
  name: string
  count: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  wallMs: number
  operationsPerSecond: number
}

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  return sorted[index] ?? 0
}

function rounded(value: number): number {
  return Number(value.toFixed(1))
}

async function measureBatch<T>(
  name: string,
  count: number,
  operation: (index: number) => Promise<T>
): Promise<{ metrics: BatchMetrics; values: T[] }> {
  const wallStarted = performance.now()
  const measurements = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const started = performance.now()
      const value = await operation(index)
      return { value, elapsedMs: performance.now() - started }
    })
  )
  const wallMs = performance.now() - wallStarted
  const durations = measurements
    .map((measurement) => measurement.elapsedMs)
    .sort((left, right) => left - right)

  return {
    metrics: {
      name,
      count,
      p50Ms: rounded(percentile(durations, 0.5)),
      p95Ms: rounded(percentile(durations, 0.95)),
      p99Ms: rounded(percentile(durations, 0.99)),
      maxMs: rounded(durations.at(-1) ?? 0),
      wallMs: rounded(wallMs),
      operationsPerSecond: rounded((count * 1_000) / Math.max(1, wallMs)),
    },
    values: measurements.map((measurement) => measurement.value),
  }
}

function assertSuccessful(name: string, values: readonly ActionResult[]): void {
  const failures = values.filter((value) => !value.success)
  if (failures.length > 0) {
    throw new Error(
      `${name}: ${failures.length} de ${values.length} operaciones fallaron. ` +
        JSON.stringify(failures.slice(0, 3))
    )
  }
}

async function runWorker(): Promise<void> {
  const [{ prisma }, registrationPlans] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/registration-plans"),
  ])
  const {
    checkoutRegistrationPlan,
    saveRegistrationPlanEntry,
    searchClubAthletesForPlan,
    setRegistrationPlanAthleteSelection,
  } = registrationPlans

  const benchmarkYear = new Date().getUTCFullYear() + 2
  const seasonId = "perf-season"
  const eventId = "perf-event"
  const startsAt = new Date(`${benchmarkYear}-06-10T00:00:00.000Z`)
  const endsAt = new Date(`${benchmarkYear}-06-12T00:00:00.000Z`)
  const seasonStartsAt = new Date(`${benchmarkYear}-01-01T00:00:00.000Z`)
  const seasonEndsAt = new Date(`${benchmarkYear}-12-31T00:00:00.000Z`)

  try {
    console.log(
      `Seed aislado: ${ATHLETES_IN_SCALE_CLUB} deportistas en el club de escala, ` +
        `${MODALITY_COUNT} modalidades y ${CONCURRENT_OPERATIONS} clubes/usuarios concurrentes.`
    )

    await prisma.season.create({
      data: {
        id: seasonId,
        year: benchmarkYear,
        name: `Temporada rendimiento ${benchmarkYear}`,
        startDate: seasonStartsAt,
        endDate: seasonEndsAt,
        isCurrent: true,
      },
    })
    await prisma.seasonFee.create({
      data: {
        id: "perf-season-fee",
        seasonId,
        discipline: "DIVING",
        clubFee: 100,
        athleteFee: 20,
      },
    })
    await prisma.event.create({
      data: {
        id: eventId,
        seasonId,
        name: "Competencia de rendimiento aislada",
        slug: `rendimiento-aislado-${benchmarkYear}`,
        disciplines: ["DIVING"],
        startDate: startsAt,
        endDate: endsAt,
        registrationDeadline: new Date(
          `${benchmarkYear}-06-01T23:59:59.000Z`
        ),
        status: "OPEN",
      },
    })

    const clubRows = Array.from({ length: CONCURRENT_OPERATIONS }, (_, index) => ({
      id: `perf-club-${index.toString().padStart(3, "0")}`,
      name: `Club rendimiento ${index.toString().padStart(3, "0")}`,
      code: `PERF-${index.toString().padStart(3, "0")}`,
    }))
    await prisma.club.createMany({ data: clubRows })
    await prisma.user.createMany({
      data: clubRows.map((club, index) => ({
        id: `perf-user-${index.toString().padStart(3, "0")}`,
        username: `perf-user-${index.toString().padStart(3, "0")}`,
        name: `Usuario rendimiento ${index}`,
        passwordHash: "performance-test-only",
        role: "CLUB" as const,
        clubId: club.id,
      })),
    })

    const athleteRows = clubRows.flatMap((club, clubIndex) => {
      const athleteCount = clubIndex === 0 ? ATHLETES_IN_SCALE_CLUB : 2
      return Array.from({ length: athleteCount }, (_, athleteIndex) => {
        const clubToken = clubIndex.toString().padStart(3, "0")
        const athleteToken = athleteIndex.toString().padStart(4, "0")
        return {
          id: `perf-athlete-${clubToken}-${athleteToken}`,
          firstNames: `Nombre ${athleteToken}`,
          lastNames: `Rendimiento ${clubToken}`,
          docType: "DNI" as const,
          docNumber: `PERF-${clubToken}-${athleteToken}`,
          birthDate: new Date("2012-04-02T00:00:00.000Z"),
          sex: athleteIndex % 2 === 0 ? ("F" as const) : ("M" as const),
          clubId: club.id,
          disciplines: ["DIVING" as const],
        }
      })
    })
    await prisma.athlete.createMany({ data: athleteRows })
    await prisma.clubAffiliation.createMany({
      data: clubRows.map((club, index) => ({
        id: `perf-club-affiliation-${index.toString().padStart(3, "0")}`,
        clubId: club.id,
        seasonId,
        discipline: "DIVING" as const,
        status: "ACTIVE" as const,
        fee: 100,
        validFrom: seasonStartsAt,
        validTo: seasonEndsAt,
      })),
    })
    await prisma.athleteAffiliation.createMany({
      data: athleteRows.map((athlete) => ({
        id: `perf-affiliation-${athlete.id}`,
        athleteId: athlete.id,
        clubId: athlete.clubId,
        seasonId,
        discipline: "DIVING" as const,
        status: "ACTIVE" as const,
        fee: 20,
        validFrom: seasonStartsAt,
        validTo: seasonEndsAt,
      })),
    })

    const modalityRows = Array.from({ length: MODALITY_COUNT }, (_, index) => ({
      id: `perf-modality-${index.toString().padStart(3, "0")}`,
      eventId,
      discipline: "DIVING" as const,
      name: `Prueba rendimiento ${index.toString().padStart(3, "0")}`,
      category: "Abierta",
      sexRule: "ANY" as const,
      birthYearFrom: 2000,
      birthYearTo: 2020,
      minAthletes: 1,
      maxAthletes: 1,
      price: 50,
      capacity: CONCURRENT_OPERATIONS,
      sortOrder: index,
      isActive: true,
    }))
    await prisma.eventModality.createMany({ data: modalityRows })

    // El seed crea directamente el estado equivalente a terminar los pasos 1 y 2.
    // Es preparacion fuera de medicion: evita confundir el benchmark con 100
    // creaciones de planilla iniciales, que no son una operacion concurrente real.
    const fixtures = clubRows.map((club, index): PlanFixture => {
      const clubToken = index.toString().padStart(3, "0")
      return {
        clubId: club.id,
        userId: `perf-user-${clubToken}`,
        primaryAthleteId: `perf-athlete-${clubToken}-0000`,
        secondaryAthleteId: `perf-athlete-${clubToken}-0001`,
        planId: `perf-plan-${clubToken}`,
        revision: 1,
      }
    })
    await prisma.registrationPlan.createMany({
      data: fixtures.map((fixture) => ({
        id: fixture.planId,
        clubId: fixture.clubId,
        eventId,
        createdById: fixture.userId,
        status: "DRAFT" as const,
        revision: fixture.revision,
        currentStep: 2,
      })),
    })
    await prisma.registrationPlanAthlete.createMany({
      data: fixtures.map((fixture, index) => ({
        id: `perf-plan-athlete-${index.toString().padStart(3, "0")}-primary`,
        planId: fixture.planId,
        athleteId: fixture.primaryAthleteId,
      })),
    })

    // Calienta el pool, el cliente Prisma y los planes de consulta antes de medir.
    for (let index = 0; index < 5; index += 1) {
      await searchClubAthletesForPlan({
        clubId: fixtures[0].clubId,
        planId: fixtures[0].planId,
        page: index + 1,
        pageSize: 30,
      })
    }

    const load = await measureBatch(
      "carga-paginada-1000-deportistas",
      CONCURRENT_OPERATIONS,
      (index) =>
        searchClubAthletesForPlan({
          clubId: fixtures[0].clubId,
          planId: fixtures[0].planId,
          page: (index % 34) + 1,
          pageSize: 30,
        })
    )
    const search = await measureBatch(
      "busqueda-servidor-1000-deportistas",
      CONCURRENT_OPERATIONS,
      (index) =>
        searchClubAthletesForPlan({
          clubId: fixtures[0].clubId,
          planId: fixtures[0].planId,
          query: `PERF-000-${((index * 17) % ATHLETES_IN_SCALE_CLUB)
            .toString()
            .padStart(4, "0")}`,
          page: 1,
          pageSize: 30,
        })
    )

    const selectionAutosave = await measureBatch<ActionResult>(
      "autoguardado-seleccion",
      CONCURRENT_OPERATIONS,
      (index) => {
        const fixture = fixtures[index]
        return setRegistrationPlanAthleteSelection({
          planId: fixture.planId,
          clubId: fixture.clubId,
          expectedRevision: fixture.revision,
          athleteId: fixture.secondaryAthleteId,
          selected: true,
        })
      }
    )
    assertSuccessful("autoguardado-seleccion", selectionAutosave.values)
    selectionAutosave.values.forEach((result, index) => {
      if (result.revision === undefined) {
        throw new Error("El autoguardado no devolvio revision.")
      }
      fixtures[index].revision = result.revision
    })

    const entryAutosave = await measureBatch<ActionResult>(
      "autoguardado-formacion",
      CONCURRENT_OPERATIONS,
      (index) => {
        const fixture = fixtures[index]
        return saveRegistrationPlanEntry({
          planId: fixture.planId,
          clubId: fixture.clubId,
          expectedRevision: fixture.revision,
          entry: {
            modalityId: modalityRows[index].id,
            athleteIds: [fixture.primaryAthleteId],
          },
        })
      }
    )
    assertSuccessful("autoguardado-formacion", entryAutosave.values)
    entryAutosave.values.forEach((result, index) => {
      if (result.revision === undefined) {
        throw new Error("El autoguardado de formacion no devolvio revision.")
      }
      fixtures[index].revision = result.revision
    })

    const checkout = await measureBatch<ActionResult>(
      "checkout-interno",
      CONCURRENT_OPERATIONS,
      (index) => {
        const fixture = fixtures[index]
        return checkoutRegistrationPlan({
          planId: fixture.planId,
          clubId: fixture.clubId,
          userId: fixture.userId,
          expectedRevision: fixture.revision,
        })
      }
    )
    assertSuccessful("checkout-interno", checkout.values)

    const [orderCount, awaitingPaymentCount] = await Promise.all([
      prisma.order.count({
        where: { kind: "REGISTRATION", status: "PENDING", eventId },
      }),
      prisma.registrationPlan.count({
        where: { eventId, status: "AWAITING_PAYMENT" },
      }),
    ])
    if (
      orderCount !== CONCURRENT_OPERATIONS ||
      awaitingPaymentCount !== CONCURRENT_OPERATIONS
    ) {
      throw new Error(
        `Integridad posterior al checkout invalida: ${orderCount} ordenes y ` +
          `${awaitingPaymentCount} planillas en espera.`
      )
    }

    const metrics = [
      load.metrics,
      search.metrics,
      selectionAutosave.metrics,
      entryAutosave.metrics,
      checkout.metrics,
    ]
    const thresholdFailures = metrics.flatMap((metric) => {
      const target =
        metric.name === "checkout-interno"
          ? CHECKOUT_TARGET_MS
          : LOAD_AUTOSAVE_TARGET_MS
      return metric.p95Ms > target
        ? [`${metric.name}: p95 ${metric.p95Ms} ms > ${target} ms`]
        : []
    })

    const databaseVersion = await prisma.$queryRaw<
      Array<{ server_version: string }>
    >`SHOW server_version`
    const cpuRows = cpus()
    console.log("\nAmbiente local (no equivalente a produccion):")
    console.log(
      JSON.stringify(
        {
          node: process.version,
          os: `${platform()} ${release()}`,
          architecture: process.arch,
          cpu: cpuRows[0]?.model ?? "desconocido",
          logicalCpuCount: cpuRows.length,
          totalMemoryGiB: rounded(totalmem() / 1024 ** 3),
          freeMemoryGiBAtEnd: rounded(freemem() / 1024 ** 3),
          postgres: databaseVersion[0]?.server_version ?? "desconocido",
          prismaPoolMaxInTestMode: 10,
        },
        null,
        2
      )
    )
    console.log("\nResultados (cada lote lanza 100 operaciones simultaneas):")
    console.table(metrics)
    console.log(
      `Integridad: ${orderCount} ordenes unicas y ${awaitingPaymentCount} planillas ` +
        "AWAITING_PAYMENT."
    )
    console.log(
      "Escenario checkout: 100 planillas completas de 100 clubes sobre 100 de las " +
        "300 modalidades compartidas; la carga/busqueda usa el club de 1.000 deportistas."
    )
    console.log(
      "Advertencia: este resultado local valida regresiones y umbrales en este equipo; " +
        "no sustituye una prueba de carga contra infraestructura equivalente a produccion."
    )

    if (thresholdFailures.length > 0) {
      throw new Error(`Umbrales excedidos:\n- ${thresholdFailures.join("\n- ")}`)
    }
  } finally {
    await prisma.$disconnect()
    const globalPool = (globalThis as typeof globalThis & { pool?: Pool }).pool
    if (globalPool) await globalPool.end()
  }
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} termino con codigo ${result.status ?? "desconocido"}.`
    )
  }
}

async function runIsolated(): Promise<void> {
  const sourceUrl = process.env.DATABASE_URL
  if (!sourceUrl) {
    throw new Error(
      "DATABASE_URL es obligatorio y solo se usa para obtener el servidor PostgreSQL."
    )
  }
  const source = new URL(sourceUrl)
  if (source.protocol !== "postgresql:" && source.protocol !== "postgres:") {
    throw new Error("El harness de rendimiento solo admite PostgreSQL.")
  }

  const databaseName = `fdnda_perf_test_${randomBytes(8).toString("hex")}`
  if (!/^fdnda_perf_test_[a-f0-9]{16}$/.test(databaseName)) {
    throw new Error("Nombre de base temporal inesperado.")
  }
  const sourceDatabaseName = decodeURIComponent(source.pathname.replace(/^\//, ""))
  if (!sourceDatabaseName || sourceDatabaseName === databaseName) {
    throw new Error("La base temporal no esta aislada de la base configurada.")
  }

  const administrationUrl = new URL(source)
  administrationUrl.pathname = "/postgres"
  administrationUrl.searchParams.delete("schema")
  const testUrl = new URL(source)
  testUrl.pathname = `/${databaseName}`
  testUrl.searchParams.delete("schema")
  const administrationPool = new Pool({
    connectionString: administrationUrl.toString(),
    max: 1,
  })
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: testUrl.toString(),
    NODE_ENV: "test",
  }

  console.log(`Creando PostgreSQL efimera validada: ${databaseName}`)
  await administrationPool.query(`CREATE DATABASE "${databaseName}"`)
  try {
    run(
      process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      childEnvironment
    )
    run(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), __filename, WORKER_FLAG],
      childEnvironment
    )
  } finally {
    if (!/^fdnda_perf_test_[a-f0-9]{16}$/.test(databaseName)) {
      throw new Error("Se rechazo la limpieza de una base no validada.")
    }
    await administrationPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName]
    )
    await administrationPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    console.log(`PostgreSQL efimera eliminada: ${databaseName}`)
    await administrationPool.end()
  }
}

const entrypoint = process.argv.includes(WORKER_FLAG) ? runWorker : runIsolated
entrypoint().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
