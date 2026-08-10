import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { normalizeClubIdentity } from "../src/lib/foundation-import"

const FOUNDATION_CODES = [
  "AQUATICA",
  "REGATAS",
  "AQUALIFE",
  "AQUALIMA",
  "CAMPO-MARTE",
  "NATACION-EXTREM",
  "RABER-TRUJILLO",
  "DRAGA-AREQUIPA",
  "TERRAZAS",
  "LIMASYNCHRO",
  "PADRE-JOSE-ASA",
]

const FOUNDATION_NAMES = [
  "Aquatica Sport Center",
  "Club de Regatas Lima",
  "Club Regatas Lima",
  "Club Deportivo Aqualife",
  "Club Deportivo Aqualima",
  "Club Deportivo Campo de Marte",
  "Club Deportivo Natacion Extrem",
  "Club Deportivo Raber de Trujillo",
  "Club Draga Waterpolo Arequipa",
  "Club Tennis Las Terrazas Miraf",
  "Club Terrazas Miraflores",
  "Lima Synchro Club",
  "Nadadores Padre Jose Alto Selva Alegre",
]

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.")
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    const allClubs = await prisma.club.findMany({
      select: {
        code: true,
        name: true,
        isActive: true,
        users: {
          where: { role: "CLUB" },
          select: { username: true, isActive: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { athletes: { where: { isActive: true } } } },
      },
      orderBy: { code: "asc" },
    })
    const acceptedNames = new Set(FOUNDATION_NAMES.map(normalizeClubIdentity))
    const clubs = allClubs.filter(
      (club) =>
        FOUNDATION_CODES.includes(club.code) || acceptedNames.has(normalizeClubIdentity(club.name))
    )
    const missing = clubs.filter(
      (club) => !club.isActive || !club.users.some((user) => user.isActive)
    )
    console.log(
      JSON.stringify(
        {
          clubs: clubs.map((club) => ({
            code: club.code,
            active: club.isActive,
            activeAthletes: club._count.athletes,
            users: club.users.map((user) => ({
              username: user.username,
              active: user.isActive,
              createdAt: user.createdAt.toISOString(),
            })),
          })),
          expectedClubs: FOUNDATION_CODES.length,
          foundClubs: clubs.length,
          missingActiveLogin: missing.map((club) => club.code),
        },
        null,
        2
      )
    )
    if (clubs.length !== FOUNDATION_CODES.length || missing.length) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Error de auditoría.")
  process.exitCode = 1
})
