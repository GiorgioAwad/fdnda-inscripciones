import "dotenv/config"
import { Pool } from "pg"

const databaseName = process.argv[2]
if (
  !databaseName ||
  !/^fdnda_(?:(?:e2e|plan)_test_[a-f0-9]{12}|perf_test_[a-f0-9]{16})$/.test(
    databaseName
  )
) {
  throw new Error(
    "Indica un nombre exacto de base temporal fdnda_*_test_<hex> validado."
  )
}

const sourceUrl = process.env.DATABASE_URL
if (!sourceUrl) throw new Error("DATABASE_URL es obligatorio.")
const administrationUrl = new URL(sourceUrl)
administrationUrl.pathname = "/postgres"
administrationUrl.searchParams.delete("schema")
const pool = new Pool({ connectionString: administrationUrl.toString(), max: 1 })

async function main() {
  const found = await pool.query(
    "SELECT datname FROM pg_database WHERE datname = $1",
    [databaseName]
  )
  if (found.rowCount === 0) {
    console.log(`La base temporal ${databaseName} ya no existe.`)
    return
  }

  console.log(`Eliminando exclusivamente la base temporal verificada ${databaseName}.`)
  await pool.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName]
  )
  await pool.query(`DROP DATABASE "${databaseName}"`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
