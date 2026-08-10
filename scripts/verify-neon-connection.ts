import "dotenv/config"
import { TLSSocket } from "node:tls"
import { Client } from "pg"

// Verifica que DATABASE_URL y DIRECT_DATABASE_URL apuntan a un Neon usable
// antes de cargarlas en el hosting. No imprime cadenas de conexión ni
// contraseñas: solo host enmascarado, base, rol y resultado de cada control.
//
//   npm run db:verify-neon
//
// Para apuntar a producción sin tocar el .env local ni pasar secretos por la
// línea de comandos, usar un archivo aparte (todo `.env*` está en .gitignore
// y en .dockerignore):
//
//   $env:DOTENV_CONFIG_PATH=".env.prod-neon"; npm run db:verify-neon
//
// El nombre importa: `.env.production` y `.env.production.local` los carga
// Next.js solo por existir, y un `next build` local acabaría hablando con la
// base de producción. `.env.prod-neon` no está en esa lista.
//
// prisma.config.ts carga dotenv igual, así que la misma variable sirve para
// `npm run db:migrate:deploy`.
//
// Complementa a production:preflight, que además exige el resto de la
// configuración de producción (Izipay, dominio, secretos).

type Target = {
  variable: "DATABASE_URL" | "DIRECT_DATABASE_URL"
  uso: string
  esperaPooler: boolean
}

const TARGETS: Target[] = [
  { variable: "DATABASE_URL", uso: "aplicación", esperaPooler: true },
  { variable: "DIRECT_DATABASE_URL", uso: "migraciones", esperaPooler: false },
]

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
const problems: string[] = []
const warnings: string[] = []

function fail(variable: string, message: string) {
  problems.push(`${variable}: ${message}`)
}

/** Deja visible solo lo necesario para identificar el endpoint. */
function maskHost(host: string) {
  const [first, ...rest] = host.split(".")
  if (rest.length === 0) return first!
  return `${first!.slice(0, 6)}….${rest.join(".")}`
}

/**
 * Neon termina TLS en su proxy, de modo que `pg_stat_ssl` ve una conexión local
 * en claro entre proxy y Postgres y reporta ssl=false aunque el tramo que cruza
 * internet sí vaya cifrado. El tramo auditable es cliente↔proxy, y ese se lee
 * del socket del cliente, no del servidor.
 */
function inspectTls(client: Client) {
  const stream = (client as unknown as { connection?: { stream?: unknown } })
    .connection?.stream
  if (!(stream instanceof TLSSocket)) return null
  return {
    protocolo: stream.getProtocol(),
    certificadoValidado: stream.authorized,
    motivo: stream.authorized ? undefined : stream.authorizationError?.message,
  }
}

function parseTarget(target: Target): URL | null {
  const value = process.env[target.variable]
  if (!value?.trim()) {
    fail(target.variable, "no está definida")
    return null
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    fail(target.variable, "no es una URL válida")
    return null
  }

  if (!url.protocol.startsWith("postgres")) {
    fail(target.variable, "debe ser una URL PostgreSQL")
  }
  if (LOCAL_HOSTS.has(url.hostname)) {
    fail(target.variable, "apunta a localhost; producción exige el host remoto")
  }
  // src/lib/env.ts rechaza el arranque en producción si falta este parámetro.
  if (url.searchParams.get("sslmode") !== "require") {
    fail(target.variable, "debe incluir sslmode=require")
  }
  if (!url.username) fail(target.variable, "no indica usuario")
  if (!url.password) fail(target.variable, "no indica contraseña")

  const pathname = url.pathname.replace(/^\//, "")
  if (!pathname) fail(target.variable, "no indica base de datos")

  const isNeon = url.hostname.endsWith("neon.tech")
  const isPooler = url.hostname.includes("-pooler")
  if (isNeon && isPooler !== target.esperaPooler) {
    fail(
      target.variable,
      target.esperaPooler
        ? "debe usar el endpoint pooled de Neon (host con -pooler)"
        : "debe usar la conexión directa de Neon (host sin -pooler)"
    )
  }
  if (!isNeon) {
    warnings.push(`${target.variable}: el host no es de Neon; se omite el control de pooler`)
  }

  return url
}

async function inspect(target: Target, url: URL) {
  const client = new Client({ connectionString: url.toString() })
  await client.connect()

  try {
    const tls = inspectTls(client)
    if (!tls) {
      fail(target.variable, "la conexión no usa TLS")
    } else if (!tls.certificadoValidado) {
      fail(
        target.variable,
        `TLS activo pero sin validar el certificado del servidor (${tls.motivo ?? "motivo desconocido"})`
      )
    }

    const { rows } = await client.query<{
      version: string
      base: string
      rol: string
    }>(`
      SELECT current_setting('server_version') AS version,
             current_database()                AS base,
             current_user                      AS rol
    `)
    const info = rows[0]!

    // El pooler de Neon funciona en modo transacción: los locks de
    // src/lib/registration-plans.ts deben seguir siendo válidos ahí.
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "verify-neon-connection",
    ])
    await client.query("COMMIT")

    let puedeCrearTablas = true
    try {
      await client.query("BEGIN")
      await client.query("CREATE TABLE _verificacion_privilegios (id int)")
      await client.query("ROLLBACK")
    } catch {
      puedeCrearTablas = false
      await client.query("ROLLBACK").catch(() => {})
    }

    if (target.variable === "DATABASE_URL" && puedeCrearTablas) {
      fail(
        "DATABASE_URL",
        "el rol de la aplicación puede crear tablas; separar privilegios con scripts/neon-prod-roles.sql"
      )
    }
    if (target.variable === "DIRECT_DATABASE_URL" && !puedeCrearTablas) {
      fail(
        "DIRECT_DATABASE_URL",
        "el rol de migración no puede crear tablas; prisma migrate deploy fallará"
      )
    }

    // Se consulta pg_catalog y no information_schema: este último solo muestra
    // los objetos sobre los que el rol conectado ya tiene algún privilegio, así
    // que con fdnda_app daría "no hay tablas" justo cuando el problema es que
    // le faltan permisos.
    const { rows: esquema } = await client.query<{
      migraciones: boolean
      tablas: number
      sinAcceso: number
    }>(`
      SELECT
        bool_or(c.relname = '_prisma_migrations') AS migraciones,
        (count(*) FILTER (
          WHERE c.relkind = 'r' AND c.relname <> '_prisma_migrations'
        ))::int AS tablas,
        (count(*) FILTER (
          WHERE c.relkind = 'r'
            AND c.relname <> '_prisma_migrations'
            AND NOT has_table_privilege(c.oid, 'SELECT')
        ))::int AS "sinAcceso"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
    `)
    const estado = esquema[0]!

    // Comprueba que el ALTER DEFAULT PRIVILEGES surtió efecto: sin él, cada
    // migración nueva deja tablas que la aplicación no puede leer.
    if (target.variable === "DATABASE_URL" && estado.sinAcceso > 0) {
      fail(
        "DATABASE_URL",
        `${estado.sinAcceso} tabla(s) sin SELECT para el rol de la aplicación; revisar el bloque 5 de scripts/neon-prod-roles.sql`
      )
    }

    return {
      variable: target.variable,
      uso: target.uso,
      host: maskHost(url.hostname),
      base: info.base,
      rol: info.rol,
      postgres: info.version,
      tls,
      puedeCrearTablas,
      migracionesAplicadas: estado.migraciones === true,
      tablas: estado.tablas,
      tablasSinAcceso: estado.sinAcceso,
    }
  } finally {
    await client.end()
  }
}

async function main() {
  const results = []

  for (const target of TARGETS) {
    const url = parseTarget(target)
    if (!url) continue
    try {
      results.push(await inspect(target, url))
    } catch (error) {
      fail(target.variable, `no se pudo conectar (${(error as Error).message})`)
    }
  }

  if (results.length === 2) {
    const [app, migrate] = results
    if (app!.base !== migrate!.base) {
      problems.push(
        `DATABASE_URL y DIRECT_DATABASE_URL apuntan a bases distintas (${app!.base} vs ${migrate!.base})`
      )
    }
    if (app!.rol === migrate!.rol) {
      warnings.push(
        `Ambas URLs usan el mismo rol (${app!.rol}); el runbook pide roles separados`
      )
    }
  }

  console.log(JSON.stringify({ conexiones: results, avisos: warnings }, null, 2))

  if (problems.length > 0) {
    throw new Error(`Verificación bloqueada: ${problems.join("; ")}`)
  }
  console.log("Neon verificado.")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
