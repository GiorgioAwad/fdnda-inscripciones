import "dotenv/config"
import { randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { Pool } from "pg"

const sourceUrl = process.env.DATABASE_URL
if (!sourceUrl) throw new Error("DATABASE_URL es obligatorio para crear la base aislada.")

const source = new URL(sourceUrl)
if (source.protocol !== "postgresql:" && source.protocol !== "postgres:") {
  throw new Error("La suite de integracion solo admite PostgreSQL.")
}

const databaseName = `fdnda_plan_test_${randomBytes(6).toString("hex")}`
if (!/^fdnda_plan_test_[a-f0-9]{12}$/.test(databaseName)) {
  throw new Error("Nombre de base de pruebas inesperado.")
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
  DIRECT_DATABASE_URL: testUrl.toString(),
  NODE_ENV: "test",
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} termino con codigo ${result.status ?? "desconocido"}.`)
  }
}

async function main() {
  await administrationPool.query(`CREATE DATABASE "${databaseName}"`)
  try {
    run(process.execPath, [
      resolve("node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ])
    run(process.execPath, [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "vitest.integration.config.mts",
    ])
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
