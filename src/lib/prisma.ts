import { PrismaClient, type Prisma } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

const databaseUrl = process.env.DATABASE_URL
const isProduction = process.env.NODE_ENV === "production"
const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX)
const poolMax = Number.isInteger(configuredPoolMax) && configuredPoolMax > 0
  ? Math.min(configuredPoolMax, 10)
  : isProduction
    ? 2
    : 10

function createPrismaClient(): PrismaClient {
  if (!databaseUrl) {
    // Durante build no hay DATABASE_URL: cliente sin adapter para no romper el build.
    return new PrismaClient()
  }

  const log: Prisma.LogLevel[] = isProduction ? ["error"] : ["error", "warn"]

  const pool =
    globalForPrisma.pool ??
    new Pool({
      connectionString: databaseUrl,
      max: poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      maxLifetimeSeconds: 60 * 30,
    })

  if (!isProduction) {
    globalForPrisma.pool = pool
  }

  const adapter = new PrismaPg(pool)

  return new PrismaClient({ adapter, log })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (!isProduction) {
  globalForPrisma.prisma = prisma
}

export default prisma
