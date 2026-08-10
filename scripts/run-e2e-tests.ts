import "dotenv/config"
import { randomBytes } from "node:crypto"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { resolve } from "node:path"
import { Pool } from "pg"

const sourceUrl = process.env.DATABASE_URL
if (!sourceUrl) throw new Error("DATABASE_URL es obligatorio para crear la base E2E.")
const source = new URL(sourceUrl)
if (source.protocol !== "postgresql:" && source.protocol !== "postgres:") {
  throw new Error("La suite E2E solo admite PostgreSQL.")
}

const databaseName = `fdnda_e2e_test_${randomBytes(6).toString("hex")}`
if (!/^fdnda_e2e_test_[a-f0-9]{12}$/.test(databaseName)) {
  throw new Error("Nombre de base E2E inesperado.")
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
const e2ePort = 3_100 + (randomBytes(2).readUInt16BE(0) % 800)
const e2eUrl = `http://localhost:${e2ePort}`
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  NODE_ENV: "test",
  PAYMENTS_MODE: "mock",
  AUTH_SECRET: "e2e-only-secret-that-is-long-enough-for-next-auth",
  AUTH_TRUST_HOST: "true",
  NEXT_PUBLIC_APP_URL: e2eUrl,
  PLAYWRIGHT_BASE_URL: e2eUrl,
}

function run(args: string[]) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`La tarea E2E termino con codigo ${result.status ?? "desconocido"}.`)
  }
}

async function waitForServer(server: ChildProcess) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js termino antes de estar listo (${server.exitCode}).`)
    }
    try {
      const response = await fetch(e2eUrl, { redirect: "manual" })
      if (response.status > 0) return
    } catch {
      // El servidor todavia esta iniciando.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  throw new Error("Next.js no estuvo listo en 60 segundos.")
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return
  server.kill()
  await Promise.race([
    new Promise<void>((resolvePromise) => server.once("exit", () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ])
}

async function main() {
  await administrationPool.query(`CREATE DATABASE "${databaseName}"`)
  try {
    run([resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"])
    run([
      resolve("node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "tsconfig.json",
      "scripts/seed-e2e.ts",
    ])
    const server = spawn(
      process.execPath,
      [
        resolve("node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "localhost",
        "--port",
        String(e2ePort),
      ],
      { cwd: process.cwd(), env: childEnvironment, stdio: "inherit" }
    )
    try {
      await waitForServer(server)
      run([
        resolve("node_modules/@playwright/test/cli.js"),
        "test",
        ...process.argv.slice(2),
      ])
    } finally {
      await stopServer(server)
    }
  } finally {
    await administrationPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName]
    )
    await administrationPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await administrationPool.end()
  })
