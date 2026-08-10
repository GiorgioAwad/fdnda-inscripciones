import "dotenv/config"
import { PrismaClient, Discipline, Sex, SexRule, DocType } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import bcrypt from "bcryptjs"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function dateUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("El seed demo está deshabilitado de forma absoluta en producción.")
  }
  if (process.env.NODE_ENV !== "test" && process.env.DEMO_SEED_CONFIRM !== "SEED_FDNDA_DEMO") {
    throw new Error(
      "Seed demo bloqueado. Para una base descartable usa DEMO_SEED_CONFIRM=SEED_FDNDA_DEMO. No ejecutes este seed en producción."
    )
  }

  const demoPasswords = {
    admin: process.env.DEMO_ADMIN_PASSWORD,
    regatas: process.env.DEMO_REGATAS_PASSWORD,
    terrazas: process.env.DEMO_TERRAZAS_PASSWORD,
  }
  for (const [account, password] of Object.entries(demoPasswords)) {
    if (!password || password.length < 12) {
      throw new Error(`Falta una contraseña demo robusta para ${account}.`)
    }
  }

  const adminPassword = await bcrypt.hash(demoPasswords.admin!, 12)
  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      name: "Administrador FDNDA",
      email: "admin@fdnda.pe",
      passwordHash: adminPassword,
      role: "ADMIN",
    },
  })

  const clubsData = [
    {
      name: "Club Regatas Lima",
      code: "REGATAS",
      region: "Lima",
      username: "regatas",
      password: demoPasswords.regatas!,
    },
    {
      name: "Club Terrazas Miraflores",
      code: "TERRAZAS",
      region: "Lima",
      username: "terrazas",
      password: demoPasswords.terrazas!,
    },
  ]

  const clubs = []
  for (const data of clubsData) {
    const club = await prisma.club.upsert({
      where: { code: data.code },
      update: {},
      create: {
        name: data.name,
        code: data.code,
        region: data.region,
      },
    })
    const passwordHash = await bcrypt.hash(data.password, 12)
    await prisma.user.upsert({
      where: { username: data.username },
      update: { clubId: club.id },
      create: {
        username: data.username,
        name: `Delegado ${data.name}`,
        passwordHash,
        role: "CLUB",
        clubId: club.id,
      },
    })
    clubs.push(club)
  }

  // Un plantel de polo Sub-16 por club: 8 varones nacidos 2011-2012, para que
  // la demo permita inscribir un equipo completo (min 7) y marcar suplentes.
  function planteles() {
    const nombres = [
      "Adrián", "Bruno", "César", "Dante", "Emilio", "Fabio", "Gonzalo", "Hugo",
    ]
    const apellidos = [
      "Ávila Ponce", "Bravo Lira", "Cueva Rosas", "Durán Neyra",
      "Escobar Tello", "Farfán Loza", "Gamarra Ruiz", "Huamán Vela",
    ]

    return [0, 1].flatMap((clubIndex) =>
      nombres.map((firstNames, i) => ({
        firstNames,
        lastNames: apellidos[i],
        docNumber: `7${2 + clubIndex}00000${i + 1}`,
        birth: dateUTC(i % 2 === 0 ? 2011 : 2012, ((i * 3) % 12) + 1, ((i * 7) % 27) + 1),
        sex: "M" as Sex,
        clubIndex,
        disciplines: [Discipline.WATER_POLO],
      }))
    )
  }

  // Padrón demo: años de nacimiento variados para probar elegibilidad.
  const athletesSeed: Array<{
    firstNames: string
    lastNames: string
    docNumber: string
    birth: Date
    sex: Sex
    clubIndex: number
    // Cada disciplina practicada genera su propia cuota anual.
    disciplines: Discipline[]
  }> = [
    { firstNames: "Valeria", lastNames: "Torres Díaz", docNumber: "70000001", birth: dateUTC(2013, 3, 12), sex: "F", clubIndex: 0, disciplines: [Discipline.DIVING] },
    { firstNames: "Camila", lastNames: "Rojas Paredes", docNumber: "70000002", birth: dateUTC(2014, 7, 25), sex: "F", clubIndex: 0, disciplines: [Discipline.ARTISTIC_SWIMMING] },
    { firstNames: "Sebastián", lastNames: "Guerra Luna", docNumber: "70000003", birth: dateUTC(2013, 11, 2), sex: "M", clubIndex: 0, disciplines: [Discipline.DIVING, Discipline.WATER_POLO] },
    { firstNames: "Diego", lastNames: "Salas Quispe", docNumber: "70000004", birth: dateUTC(2011, 5, 18), sex: "M", clubIndex: 0, disciplines: [Discipline.WATER_POLO] },
    { firstNames: "Luciana", lastNames: "Fernández Cano", docNumber: "70000005", birth: dateUTC(2011, 9, 9), sex: "F", clubIndex: 0, disciplines: [Discipline.ARTISTIC_SWIMMING, Discipline.WATER_POLO] },
    { firstNames: "Ariana", lastNames: "Mendoza Silva", docNumber: "70000006", birth: dateUTC(2015, 1, 30), sex: "F", clubIndex: 0, disciplines: [Discipline.DIVING] },
    { firstNames: "Mateo", lastNames: "Castro Vega", docNumber: "70000007", birth: dateUTC(2016, 4, 14), sex: "M", clubIndex: 0, disciplines: [Discipline.DIVING] },
    { firstNames: "Micaela", lastNames: "Herrera Ríos", docNumber: "70000008", birth: dateUTC(2010, 12, 21), sex: "F", clubIndex: 0, disciplines: [Discipline.WATER_POLO] },
    { firstNames: "Rafaela", lastNames: "Campos Soto", docNumber: "71000001", birth: dateUTC(2013, 6, 5), sex: "F", clubIndex: 1, disciplines: [Discipline.ARTISTIC_SWIMMING] },
    { firstNames: "Emilia", lastNames: "Vargas Poma", docNumber: "71000002", birth: dateUTC(2014, 2, 17), sex: "F", clubIndex: 1, disciplines: [Discipline.ARTISTIC_SWIMMING] },
    { firstNames: "Thiago", lastNames: "Nuñez Ramos", docNumber: "71000003", birth: dateUTC(2014, 8, 8), sex: "M", clubIndex: 1, disciplines: [Discipline.DIVING, Discipline.WATER_POLO] },
    { firstNames: "Gael", lastNames: "Paz Aguilar", docNumber: "71000004", birth: dateUTC(2012, 10, 3), sex: "M", clubIndex: 1, disciplines: [Discipline.WATER_POLO] },
    { firstNames: "Antonella", lastNames: "Ibáñez Cruz", docNumber: "71000005", birth: dateUTC(2012, 3, 28), sex: "F", clubIndex: 1, disciplines: [Discipline.ARTISTIC_SWIMMING, Discipline.WATER_POLO] },
    { firstNames: "Renata", lastNames: "Morales Chu", docNumber: "71000006", birth: dateUTC(2015, 11, 11), sex: "F", clubIndex: 1, disciplines: [Discipline.DIVING] },
    { firstNames: "Joaquín", lastNames: "Delgado Peña", docNumber: "71000007", birth: dateUTC(2009, 7, 7), sex: "M", clubIndex: 1, disciplines: [Discipline.WATER_POLO] },
    { firstNames: "Brianna", lastNames: "Flores Inga", docNumber: "71000008", birth: dateUTC(2016, 9, 19), sex: "F", clubIndex: 1, disciplines: [Discipline.DIVING] },
    // Planteles Sub-16 de polo (nacidos 2011-2012): 8 por club, para poder
    // inscribir un equipo completo (mínimo 7 + suplentes) en la demo.
    ...planteles(),
  ]

  for (const a of athletesSeed) {
    await prisma.athlete.upsert({
      where: { docNumber: a.docNumber },
      update: { disciplines: a.disciplines },
      create: {
        firstNames: a.firstNames,
        lastNames: a.lastNames,
        docType: DocType.DNI,
        docNumber: a.docNumber,
        birthDate: a.birth,
        sex: a.sex,
        clubId: clubs[a.clubIndex].id,
        disciplines: a.disciplines,
      },
    })
  }

  // ---- Temporadas de afiliación ----
  // La vigente (2026) y la anterior (2025), para que el panel del club muestre
  // deportistas "por reafiliar" además de los nuevos.
  const seasonPrev = await prisma.season.upsert({
    where: { year: 2025 },
    update: {},
    create: {
      year: 2025,
      name: "Temporada 2025",
      startDate: dateUTC(2025, 1, 1),
      endDate: dateUTC(2025, 12, 31),
      isCurrent: false,
    },
  })

  const season = await prisma.season.upsert({
    where: { year: 2026 },
    update: {},
    create: {
      year: 2026,
      name: "Temporada 2026",
      startDate: dateUTC(2026, 1, 1),
      endDate: dateUTC(2026, 12, 31),
      isCurrent: true,
    },
  })

  // Tarifario por disciplina: polo cuesta más porque compite por planteles.
  const feesSeed: Record<Discipline, { clubFee: number; athleteFee: number }> = {
    [Discipline.DIVING]: { clubFee: 1500, athleteFee: 80 },
    [Discipline.ARTISTIC_SWIMMING]: { clubFee: 1600, athleteFee: 90 },
    [Discipline.WATER_POLO]: { clubFee: 1800, athleteFee: 110 },
  }

  const feeBySeasonAndDiscipline = new Map<string, { clubFee: number; athleteFee: number }>()

  for (const targetSeason of [seasonPrev, season]) {
    // La temporada anterior costaba un 10% menos: sirve para ver el snapshot.
    const factor = targetSeason.year === 2025 ? 0.9 : 1

    for (const discipline of Object.values(Discipline)) {
      const base = feesSeed[discipline]
      const fee = {
        clubFee: Math.round(base.clubFee * factor),
        athleteFee: Math.round(base.athleteFee * factor),
      }

      await prisma.seasonFee.upsert({
        where: {
          seasonId_discipline: { seasonId: targetSeason.id, discipline },
        },
        update: fee,
        create: { seasonId: targetSeason.id, discipline, ...fee },
      })

      feeBySeasonAndDiscipline.set(`${targetSeason.id}:${discipline}`, fee)
    }
  }

  // Categorías por edad: etiqueta informativa, no restringen la inscripción.
  const categoriesSeed = [
    { discipline: Discipline.DIVING, name: "Categoría D", from: 2015, to: 2017 },
    { discipline: Discipline.DIVING, name: "Categoría C", from: 2013, to: 2014 },
    { discipline: Discipline.DIVING, name: "Categoría B", from: 2011, to: 2012 },
    { discipline: Discipline.DIVING, name: "Categoría A", from: 2008, to: 2010 },
    { discipline: Discipline.ARTISTIC_SWIMMING, name: "Infantil A", from: 2015, to: 2016 },
    { discipline: Discipline.ARTISTIC_SWIMMING, name: "Infantil B", from: 2013, to: 2014 },
    { discipline: Discipline.ARTISTIC_SWIMMING, name: "Juvenil", from: 2010, to: 2012 },
    { discipline: Discipline.ARTISTIC_SWIMMING, name: "Mayores", from: null, to: 2009 },
    { discipline: Discipline.WATER_POLO, name: "Sub-14", from: 2013, to: 2016 },
    { discipline: Discipline.WATER_POLO, name: "Sub-16", from: 2011, to: 2012 },
    { discipline: Discipline.WATER_POLO, name: "Sub-18", from: 2009, to: 2010 },
    { discipline: Discipline.WATER_POLO, name: "Mayores", from: null, to: 2008 },
  ]

  for (const [index, category] of categoriesSeed.entries()) {
    await prisma.category.upsert({
      where: {
        seasonId_discipline_name: {
          seasonId: season.id,
          discipline: category.discipline,
          name: category.name,
        },
      },
      update: {},
      create: {
        seasonId: season.id,
        discipline: category.discipline,
        name: category.name,
        birthYearFrom: category.from,
        birthYearTo: category.to,
        sortOrder: index,
      },
    })
  }

  // ---- Afiliaciones demo: cubren los cuatro estados del panel ----
  // Regatas al día en las tres disciplinas. Terrazas al día solo en polo, con
  // clavados PENDIENTE y artística sin afiliar: así se ve de una que el bloqueo
  // para inscribir es por disciplina, no por club.
  const clubAffiliations: Array<{
    clubIndex: number
    season: typeof season
    discipline: Discipline
    status: "ACTIVE" | "PENDING"
  }> = [
    ...Object.values(Discipline).flatMap((discipline) => [
      { clubIndex: 0, season: seasonPrev, discipline, status: "ACTIVE" as const },
      { clubIndex: 0, season, discipline, status: "ACTIVE" as const },
      { clubIndex: 1, season: seasonPrev, discipline, status: "ACTIVE" as const },
    ]),
    { clubIndex: 1, season, discipline: Discipline.WATER_POLO, status: "ACTIVE" },
    { clubIndex: 1, season, discipline: Discipline.DIVING, status: "PENDING" },
    // Artística de Terrazas 2026 se deja sin fila: estado SIN_AFILIAR.
  ]

  for (const item of clubAffiliations) {
    const fee = feeBySeasonAndDiscipline.get(`${item.season.id}:${item.discipline}`)!

    await prisma.clubAffiliation.upsert({
      where: {
        clubId_seasonId_discipline: {
          clubId: clubs[item.clubIndex].id,
          seasonId: item.season.id,
          discipline: item.discipline,
        },
      },
      update: {},
      create: {
        clubId: clubs[item.clubIndex].id,
        seasonId: item.season.id,
        discipline: item.discipline,
        status: item.status,
        fee: fee.clubFee,
        validFrom: item.season.startDate,
        validTo: item.season.endDate,
        paidAt: item.status === "ACTIVE" ? new Date() : null,
      },
    })
  }

  // Documentos según el estado que queremos ver en el panel de deportistas.
  // El plantel de polo de Regatas (72xxxxxx) va afiliado: así la demo permite
  // inscribir un equipo completo de una. El de Terrazas (73xxxxxx) queda por
  // afiliar, para ver el flujo de regularización.
  const regatasPolo = Array.from({ length: 8 }, (_, i) => `7200000${i + 1}`)
  const affiliated2026 = ["70000001", "70000002", "70000003", "70000004", "70000005", "71000001", "71000002", "71000003", ...regatasPolo]
  const pending2026 = ["70000006"]
  // Solo 2025: aparecen como "por reafiliar".
  const affiliated2025Only = ["70000007", "71000004", "71000005", "71000006"]
  // 70000008, 71000007 y 71000008 quedan sin afiliación: "por afiliar".

  const athleteRecords = await prisma.athlete.findMany({
    where: { docNumber: { in: athletesSeed.map((a) => a.docNumber) } },
    select: { id: true, docNumber: true, clubId: true, disciplines: true },
  })
  const athleteByDoc = new Map(athleteRecords.map((a) => [a.docNumber, a]))

  // Afilia a cada deportista en TODAS las disciplinas que practica: una cuota
  // por cada una, igual que en el portal.
  async function affiliateAthletes(
    docNumbers: string[],
    targetSeason: typeof season,
    status: "ACTIVE" | "PENDING"
  ) {
    for (const docNumber of docNumbers) {
      const athlete = athleteByDoc.get(docNumber)
      if (!athlete) continue

      for (const discipline of athlete.disciplines) {
        const fee = feeBySeasonAndDiscipline.get(`${targetSeason.id}:${discipline}`)!

        await prisma.athleteAffiliation.upsert({
          where: {
            athleteId_seasonId_discipline: {
              athleteId: athlete.id,
              seasonId: targetSeason.id,
              discipline,
            },
          },
          update: {},
          create: {
            athleteId: athlete.id,
            clubId: athlete.clubId,
            seasonId: targetSeason.id,
            discipline,
            status,
            fee: fee.athleteFee,
            validFrom: targetSeason.startDate,
            validTo: targetSeason.endDate,
            paidAt: status === "ACTIVE" ? new Date() : null,
          },
        })
      }
    }
  }

  await affiliateAthletes([...affiliated2026, ...affiliated2025Only], seasonPrev, "ACTIVE")
  await affiliateAthletes(affiliated2026, season, "ACTIVE")
  await affiliateAthletes(pending2026, season, "PENDING")

  // Evento demo con inscripción abierta.
  const event = await prisma.event.upsert({
    where: { slug: "campeonato-nacional-2026" },
    update: { seasonId: season.id },
    create: {
      seasonId: season.id,
      name: "Campeonato Nacional de Deportes Acuáticos 2026",
      slug: "campeonato-nacional-2026",
      disciplines: [
        Discipline.DIVING,
        Discipline.ARTISTIC_SWIMMING,
        Discipline.WATER_POLO,
      ],
      venue: "Centro Acuático VIDENA",
      city: "Lima",
      startDate: dateUTC(2026, 8, 21),
      endDate: dateUTC(2026, 8, 23),
      registrationDeadline: new Date("2026-08-14T23:59:00-05:00"),
      status: "OPEN",
      description:
        "Campeonato nacional oficial. Inscripciones por club hasta el 14 de agosto.",
    },
  })

  const existingModalities = await prisma.eventModality.count({
    where: { eventId: event.id },
  })

  if (existingModalities === 0) {
    // Clavados: grupos de edad World Aquatics (evento 2026):
    // Cat D 9-11 (2015-2017), Cat C 12-13 (2013-2014), Cat B 14-15 (2011-2012).
    const divingBoards = ["Trampolín 1m", "Trampolín 3m", "Plataforma"]
    const divingCategories = [
      { label: "Categoría D", from: 2015, to: 2017 },
      { label: "Categoría C", from: 2013, to: 2014 },
      { label: "Categoría B", from: 2011, to: 2012 },
    ]
    const sexes: Array<{ rule: SexRule; label: string }> = [
      { rule: "FEMALE", label: "Damas" },
      { rule: "MALE", label: "Varones" },
    ]

    let sortOrder = 0
    for (const category of divingCategories) {
      for (const board of divingBoards) {
        for (const sex of sexes) {
          await prisma.eventModality.create({
            data: {
              eventId: event.id,
              discipline: Discipline.DIVING,
              name: board,
              category: `${category.label} — ${sex.label}`,
              sexRule: sex.rule,
              birthYearFrom: category.from,
              birthYearTo: category.to,
              minAthletes: 1,
              maxAthletes: 1,
              price: 50,
              sortOrder: sortOrder++,
            },
          })
        }
      }
    }

    // Natación artística: solo, dueto y equipo. Los rangos siguen las categorías
    // de la temporada (Infantil B 2013–2014, Juvenil 2010–2012) y las pruebas
    // individuales llevan "sube de categoría": los del último año de la categoría
    // inferior pueden competir en la superior (Solo, Figuras, Estrellas), así que
    // Solo Juvenil admite además a las nacidas en 2013.
    const artisticModalities = [
      { name: "Solo Libre", category: "Infantil B — Damas", sexRule: "FEMALE" as SexRule, from: 2013, to: 2014, min: 1, max: 1, price: 60, upgrade: true },
      { name: "Solo Libre", category: "Juvenil — Damas", sexRule: "FEMALE" as SexRule, from: 2010, to: 2012, min: 1, max: 1, price: 60, upgrade: true },
      { name: "Figuras", category: "Infantil B — Damas", sexRule: "FEMALE" as SexRule, from: 2013, to: 2014, min: 1, max: 1, price: 45, upgrade: true },
      { name: "Figuras", category: "Juvenil — Damas", sexRule: "FEMALE" as SexRule, from: 2010, to: 2012, min: 1, max: 1, price: 45, upgrade: true },
      { name: "Dueto Libre", category: "Infantil B — Damas", sexRule: "FEMALE" as SexRule, from: 2013, to: 2014, min: 2, max: 2, price: 100, upgrade: false },
      { name: "Dueto Libre", category: "Juvenil — Damas", sexRule: "FEMALE" as SexRule, from: 2010, to: 2012, min: 2, max: 2, price: 100, upgrade: false },
      { name: "Dueto Mixto", category: "Juvenil", sexRule: "MIXED" as SexRule, from: 2010, to: 2014, min: 2, max: 2, price: 100, upgrade: false },
      { name: "Equipo Libre", category: "Juvenil", sexRule: "ANY" as SexRule, from: 2009, to: 2014, min: 4, max: 8, price: 200, upgrade: false },
    ]

    for (const m of artisticModalities) {
      await prisma.eventModality.create({
        data: {
          eventId: event.id,
          discipline: Discipline.ARTISTIC_SWIMMING,
          name: m.name,
          category: m.category,
          sexRule: m.sexRule,
          birthYearFrom: m.from,
          birthYearTo: m.to,
          allowsCategoryUpgrade: m.upgrade,
          categoryUpgradeBirthYear: m.upgrade ? m.to + 1 : null,
          minAthletes: m.min,
          maxAthletes: m.max,
          price: m.price,
          sortOrder: sortOrder++,
        },
      })
    }

    // Polo acuático: se compite por plantel (7 en agua + suplentes), así que la
    // inscripción es una sola por club con un rango amplio de integrantes.
    const waterPoloModalities = [
      { category: "Sub-14 — Damas", sexRule: "FEMALE" as SexRule, from: 2013, to: 2016 },
      { category: "Sub-14 — Varones", sexRule: "MALE" as SexRule, from: 2013, to: 2016 },
      { category: "Sub-16 — Damas", sexRule: "FEMALE" as SexRule, from: 2011, to: 2012 },
      { category: "Sub-16 — Varones", sexRule: "MALE" as SexRule, from: 2011, to: 2012 },
      { category: "Sub-18 — Varones", sexRule: "MALE" as SexRule, from: 2009, to: 2010 },
    ]

    for (const m of waterPoloModalities) {
      await prisma.eventModality.create({
        data: {
          eventId: event.id,
          discipline: Discipline.WATER_POLO,
          name: "Torneo por equipos",
          category: m.category,
          sexRule: m.sexRule,
          birthYearFrom: m.from,
          birthYearTo: m.to,
          minAthletes: 7,
          maxAthletes: 13,
          price: 350,
          sortOrder: sortOrder++,
        },
      })
    }
  }

  // Si el seed se vuelve a ejecutar sobre una demo creada antes del campo
  // explícito, completa el snapshot sin duplicar modalidades.
  const upgradeModalities = await prisma.eventModality.findMany({
    where: {
      eventId: event.id,
      discipline: Discipline.ARTISTIC_SWIMMING,
      allowsCategoryUpgrade: true,
      birthYearTo: { not: null },
    },
    select: { id: true, birthYearTo: true },
  })

  for (const modality of upgradeModalities) {
    await prisma.eventModality.update({
      where: { id: modality.id },
      data: { categoryUpgradeBirthYear: modality.birthYearTo! + 1 },
    })
  }

  // Evento borrador para probar estados en el panel admin.
  await prisma.event.upsert({
    where: { slug: "copa-fdnda-clavados-2026" },
    update: { seasonId: season.id },
    create: {
      seasonId: season.id,
      name: "Copa FDNDA de Clavados 2026",
      slug: "copa-fdnda-clavados-2026",
      disciplines: [Discipline.DIVING],
      venue: "Piscina Campo de Marte",
      city: "Lima",
      startDate: dateUTC(2026, 10, 10),
      endDate: dateUTC(2026, 10, 11),
      registrationDeadline: new Date("2026-10-02T23:59:00-05:00"),
      status: "DRAFT",
    },
  })

  console.log("Seed completado.")
  console.log("  ADMIN  -> usuario: admin (clave definida por entorno)")
  console.log("  CLUB 1 -> usuario: regatas (2026 al día en las 3 disciplinas)")
  console.log("  CLUB 2 -> usuario: terrazas (2026 solo polo al día)")
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
