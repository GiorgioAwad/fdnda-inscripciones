import "dotenv/config"
import { PrismaClient, type Discipline } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

// Backfill de afiliaciones para bases que ya operaban antes del módulo.
//
// Los clubes de la FDNDA ya estaban afiliados cuando se construyó esta
// funcionalidad: sin este paso, el bloqueo duro de inscripciones dejaría fuera a
// todo el mundo el día del despliegue. El script crea la temporada vigente (si
// falta), le fija el tarifario por disciplina y genera afiliaciones ACTIVE a
// cada club y a cada deportista activo en las disciplinas que practica. Es
// idempotente: correrlo dos veces no duplica ni pisa nada.
//
//   npx tsx scripts/backfill-afiliaciones.ts [--year=2026] [--club-fee=1500]
//                                            [--athlete-fee=80]
//                                            [--disciplines=DIVING,WATER_POLO]
//                                            [--dry-run]
//
// --disciplines limita a qué disciplinas se afilia (por defecto, todas las que
// ya tengan tarifa; si la temporada es nueva, las tres).

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const ALL_DISCIPLINES: Discipline[] = [
  "DIVING",
  "ARTISTIC_SWIMMING",
  "WATER_POLO",
]

function arg(name: string): string | undefined {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`))
  return found?.split("=")[1]
}

function numberArg(name: string, fallback: number): number {
  const raw = arg(name)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${name} debe ser un número válido (recibido: "${raw}")`)
  }
  return parsed
}

function disciplinesArg(): Discipline[] | undefined {
  const raw = arg("disciplines")
  if (raw === undefined) return undefined

  const values = raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)

  const invalid = values.filter(
    (value) => !ALL_DISCIPLINES.includes(value as Discipline)
  )
  if (invalid.length > 0) {
    throw new Error(
      `--disciplines inválidas: ${invalid.join(", ")}. Válidas: ${ALL_DISCIPLINES.join(", ")}`
    )
  }
  return values as Discipline[]
}

function dateUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const year = numberArg("year", new Date().getFullYear())
  const clubFee = numberArg("club-fee", 1500)
  const athleteFee = numberArg("athlete-fee", 80)
  const requested = disciplinesArg()

  const validFrom = dateUTC(year, 1, 1)
  const validTo = dateUTC(year, 12, 31)

  let season = await prisma.season.findUnique({ where: { year } })

  if (!season) {
    console.log(`Temporada ${year}: no existe, se creará (vigente).`)
    if (!dryRun) {
      season = await prisma.$transaction(async (tx) => {
        await tx.season.updateMany({
          where: { isCurrent: true },
          data: { isCurrent: false },
        })
        return tx.season.create({
          data: {
            year,
            name: `Temporada ${year}`,
            startDate: validFrom,
            endDate: validTo,
            isCurrent: true,
          },
        })
      })
    }
  } else {
    console.log(`Temporada ${year}: ya existe (${season.name}).`)
  }

  if (!season) {
    console.log("(dry-run) Sin temporada no se puede simular el resto.")
    return
  }

  // Tarifario: las disciplinas pedidas que aún no lo tengan reciben las cuotas
  // de los flags. Las que ya lo tienen no se pisan.
  const targetDisciplines = requested ?? ALL_DISCIPLINES

  if (!dryRun) {
    for (const discipline of targetDisciplines) {
      await prisma.seasonFee.upsert({
        where: { seasonId_discipline: { seasonId: season.id, discipline } },
        update: {},
        create: { seasonId: season.id, discipline, clubFee, athleteFee },
      })
    }
  }

  const fees = await prisma.seasonFee.findMany({ where: { seasonId: season.id } })
  const feeByDiscipline = new Map(fees.map((fee) => [fee.discipline, fee]))

  // Sin tarifa no se puede emitir una afiliación: se salta la disciplina.
  const disciplines = targetDisciplines.filter((discipline) => {
    if (feeByDiscipline.has(discipline)) return true
    console.log(`  ${discipline}: sin tarifa en ${year}, se omite.`)
    return false
  })

  if (disciplines.length === 0) {
    console.log("No hay disciplinas con tarifa para afiliar.")
    return
  }

  console.log(`Disciplinas a afiliar: ${disciplines.join(", ")}`)

  const paidAt = new Date()

  for (const discipline of disciplines) {
    const fee = feeByDiscipline.get(discipline)

    const clubs = await prisma.club.findMany({
      where: {
        isActive: true,
        affiliations: { none: { seasonId: season.id, discipline } },
      },
      select: { id: true },
    })

    console.log(`  ${discipline} · clubes sin afiliación ${year}: ${clubs.length}`)
    if (!dryRun && clubs.length > 0 && fee) {
      await prisma.clubAffiliation.createMany({
        data: clubs.map((club) => ({
          clubId: club.id,
          seasonId: season.id,
          discipline,
          status: "ACTIVE" as const,
          fee: fee.clubFee,
          validFrom: season.startDate,
          validTo: season.endDate,
          paidAt,
        })),
        skipDuplicates: true,
      })
    }

    // Solo quienes tienen la disciplina registrada en el padrón: afiliar a un
    // clavadista en polo le cobraría una cuota que nadie pidió.
    const athletes = await prisma.athlete.findMany({
      where: {
        isActive: true,
        disciplines: { has: discipline },
        affiliations: { none: { seasonId: season.id, discipline } },
      },
      select: { id: true, clubId: true },
    })

    console.log(
      `  ${discipline} · deportistas sin afiliación ${year}: ${athletes.length}`
    )
    if (!dryRun && athletes.length > 0 && fee) {
      // En lotes para no armar un INSERT gigante con padrones grandes.
      const BATCH = 500
      for (let i = 0; i < athletes.length; i += BATCH) {
        await prisma.athleteAffiliation.createMany({
          data: athletes.slice(i, i + BATCH).map((athlete) => ({
            athleteId: athlete.id,
            clubId: athlete.clubId,
            seasonId: season.id,
            discipline,
            status: "ACTIVE" as const,
            fee: fee.athleteFee,
            validFrom: season.startDate,
            validTo: season.endDate,
            paidAt,
          })),
          skipDuplicates: true,
        })
      }
    }
  }

  console.log(dryRun ? "Simulación terminada (no se escribió nada)." : "Backfill completado.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
