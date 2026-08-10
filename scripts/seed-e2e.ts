import "dotenv/config"
import bcrypt from "bcryptjs"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL es obligatorio.")

const pool = new Pool({ connectionString: databaseUrl })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function dateFromToday(days: number) {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + days)
  return date
}

async function createClubFixture(input: {
  code: string
  username: string
  password: string
  athleteDocs: string[]
  affiliateAthletes: boolean
  discipline?: "DIVING" | "ARTISTIC_SWIMMING"
  birthDate?: string
  mustChangePassword?: boolean
}) {
  const discipline = input.discipline ?? "DIVING"
  const club = await prisma.club.create({
    data: { name: `Club E2E ${input.code}`, code: input.code },
  })
  await prisma.user.create({
    data: {
      username: input.username,
      name: `Delegado ${input.code}`,
      passwordHash: await bcrypt.hash(input.password, 4),
      role: "CLUB",
      clubId: club.id,
      mustChangePassword: input.mustChangePassword ?? false,
    },
  })
  const athletes = []
  for (const [index, docNumber] of input.athleteDocs.entries()) {
    athletes.push(
      await prisma.athlete.create({
        data: {
          firstNames: index === 0 ? "Valeria" : "Camila",
          lastNames: `E2E ${input.code}`,
          docNumber,
          birthDate: new Date(input.birthDate ?? "2013-04-02T00:00:00.000Z"),
          sex: "F",
          clubId: club.id,
          disciplines: [discipline],
        },
      })
    )
  }
  return {
    club,
    athletes,
    affiliateAthletes: input.affiliateAthletes,
    discipline,
  }
}

async function main() {
  const year = new Date().getUTCFullYear() + 1
  const season = await prisma.season.create({
    data: {
      year,
      name: `Temporada E2E ${year}`,
      startDate: dateFromToday(-30),
      endDate: dateFromToday(365),
      isCurrent: true,
    },
  })
  await prisma.seasonFee.createMany({
    data: ["DIVING", "ARTISTIC_SWIMMING"].map((discipline) => ({
      seasonId: season.id,
      discipline: discipline as "DIVING" | "ARTISTIC_SWIMMING",
      clubFee: 100,
      athleteFee: 20,
    })),
  })

  const fixtures = await Promise.all([
    createClubFixture({
      code: "MAIN",
      username: "e2e-club",
      password: "E2eClub123!",
      athleteDocs: ["88000001", "88000002"],
      affiliateAthletes: true,
    }),
    createClubFixture({
      code: "NOAFF",
      username: "e2e-missing",
      password: "E2eMissing123!",
      athleteDocs: ["88000003"],
      affiliateAthletes: false,
    }),
    createClubFixture({
      code: "NETWORK",
      username: "e2e-network",
      password: "E2eNetwork123!",
      athleteDocs: ["88000004"],
      affiliateAthletes: true,
    }),
    createClubFixture({
      code: "UPGRADE",
      username: "e2e-upgrade",
      password: "E2eUpgrade123!",
      athleteDocs: ["88000005"],
      affiliateAthletes: true,
      discipline: "ARTISTIC_SWIMMING",
      birthDate: "2013-04-02T00:00:00.000Z",
    }),
    createClubFixture({
      code: "DRAFT",
      username: "e2e-draft",
      password: "E2eDraft123!",
      athleteDocs: ["88000006"],
      affiliateAthletes: true,
    }),
    createClubFixture({
      code: "PASSWORD",
      username: "e2e-temporary",
      password: "Temporary123!",
      athleteDocs: [],
      affiliateAthletes: false,
      mustChangePassword: true,
    }),
  ])

  for (const fixture of fixtures) {
    await prisma.clubAffiliation.create({
      data: {
        clubId: fixture.club.id,
        seasonId: season.id,
        discipline: fixture.discipline,
        status: "ACTIVE",
        fee: 100,
        validFrom: season.startDate,
        validTo: season.endDate,
      },
    })
    if (fixture.affiliateAthletes) {
      await prisma.athleteAffiliation.createMany({
        data: fixture.athletes.map((athlete) => ({
          athleteId: athlete.id,
          clubId: fixture.club.id,
          seasonId: season.id,
          discipline: fixture.discipline,
          status: "ACTIVE" as const,
          fee: 20,
          validFrom: season.startDate,
          validTo: season.endDate,
        })),
      })
    }
  }

  const event = await prisma.event.create({
    data: {
      seasonId: season.id,
      name: "Competencia E2E",
      slug: "competencia-e2e",
      disciplines: ["DIVING"],
      venue: "Piscina de pruebas",
      city: "Lima",
      startDate: dateFromToday(30),
      endDate: dateFromToday(32),
      registrationDeadline: dateFromToday(20),
      status: "OPEN",
    },
  })
  await prisma.eventModality.create({
    data: {
      eventId: event.id,
      discipline: "DIVING",
      name: "Trampolin E2E",
      category: "2013 - Damas",
      sexRule: "FEMALE",
      birthYearFrom: 2013,
      birthYearTo: 2013,
      minAthletes: 1,
      maxAthletes: 1,
      price: 50,
      capacity: 20,
    },
  })
  // Prueba de equipo: es la única forma de dejar una formación incompleta, que
  // es lo que ejercita el borrador persistente.
  await prisma.eventModality.create({
    data: {
      eventId: event.id,
      discipline: "DIVING",
      name: "Sincronizados E2E",
      category: "2013 - Damas",
      sexRule: "FEMALE",
      birthYearFrom: 2013,
      birthYearTo: 2013,
      minAthletes: 2,
      maxAthletes: 2,
      price: 70,
      capacity: 20,
    },
  })

  await prisma.category.createMany({
    data: [
      {
        seasonId: season.id,
        discipline: "ARTISTIC_SWIMMING",
        name: "Juvenil E2E",
        birthYearFrom: 2010,
        birthYearTo: 2012,
        sortOrder: 1,
      },
      {
        seasonId: season.id,
        discipline: "ARTISTIC_SWIMMING",
        name: "Infantil B E2E",
        birthYearFrom: 2013,
        birthYearTo: 2014,
        sortOrder: 2,
      },
    ],
  })
  const artisticEvent = await prisma.event.create({
    data: {
      seasonId: season.id,
      name: "Artística E2E Ascenso",
      slug: "artistica-e2e-ascenso",
      disciplines: ["ARTISTIC_SWIMMING"],
      venue: "Piscina artística de pruebas",
      city: "Lima",
      startDate: dateFromToday(35),
      endDate: dateFromToday(37),
      registrationDeadline: dateFromToday(25),
      status: "OPEN",
    },
  })
  await prisma.eventModality.create({
    data: {
      eventId: artisticEvent.id,
      discipline: "ARTISTIC_SWIMMING",
      name: "Solo E2E ascenso",
      category: "Juvenil — Damas",
      sexRule: "FEMALE",
      birthYearFrom: 2010,
      birthYearTo: 2012,
      allowsCategoryUpgrade: true,
      categoryUpgradeBirthYear: 2013,
      minAthletes: 1,
      maxAthletes: 1,
      price: 60,
      capacity: 20,
    },
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
