import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

vi.mock("./prisma", () => ({ prisma: {} }))

import {
  isValidCategoryUpgradeConfiguration,
  validateRegistrationPlanInTransaction,
  type PlanTransactionClient,
  type RegistrationPlanForValidation,
} from "./plan-validation"

type Athlete = RegistrationPlanForValidation["athletes"][number]["athlete"]
type Modality =
  RegistrationPlanForValidation["registrations"][number]["modality"]
type Registration = RegistrationPlanForValidation["registrations"][number]
type Category = NonNullable<
  RegistrationPlanForValidation["event"]
>["season"] extends infer Season
  ? Season extends { categories: Array<infer Item> }
    ? Item
    : never
  : never

const now = new Date("2026-08-01T12:00:00.000Z")

function athlete(
  id: string,
  overrides: Partial<Athlete> = {}
): Athlete {
  return {
    id,
    firstNames: `Nombre ${id}`,
    lastNames: "Apellido",
    docType: "DNI",
    docNumber: `DOC-${id}`,
    birthDate: new Date("2012-03-10T00:00:00.000Z"),
    sex: "F",
    clubId: "club-1",
    isActive: true,
    disciplines: ["ARTISTIC_SWIMMING"],
    privacyNoticeVersion: null,
    privacyAcceptedAt: null,
    privacyAcceptedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function modality(id: string, overrides: Partial<Modality> = {}): Modality {
  return {
    id,
    eventId: "event-1",
    discipline: "ARTISTIC_SWIMMING",
    name: `Prueba ${id}`,
    category: "Juvenil",
    level: null,
    sexRule: "ANY",
    birthYearFrom: null,
    birthYearTo: null,
    allowsCategoryUpgrade: false,
    categoryUpgradeBirthYear: null,
    minAthletes: 1,
    maxAthletes: 1,
    price: new Prisma.Decimal(100),
    pricePerMatch: null,
    matchesPerTeam: null,
    expectedTeams: null,
    capacity: null,
    sortOrder: 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function registration(
  id: string,
  target: Modality,
  members: Array<{ athlete: Athlete; isReserve?: boolean }>
): Registration {
  return {
    id,
    planId: "plan-1",
    modalityId: target.id,
    modality: target,
    clubId: "club-1",
    status: "IN_CART",
    activeOrderId: null,
    createdAt: now,
    updatedAt: now,
    athletes: members.map((member, index) => ({
      id: `${id}-athlete-${index}`,
      registrationId: id,
      athleteId: member.athlete.id,
      modalityId: target.id,
      isReserve: member.isReserve ?? false,
      athlete: member.athlete,
    })),
  }
}

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: "category-lower",
    seasonId: "season-1",
    discipline: "ARTISTIC_SWIMMING",
    name: "Infantil B",
    birthYearFrom: 2013,
    birthYearTo: 2014,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function plan(input: {
  roster: Athlete[]
  registrations: Registration[]
  categories?: Category[]
  disciplineConfigs?: Array<{
    discipline: string
    chargesEntry: boolean
    chargesAthleteFee: boolean
    athleteFee: string | null
    ageRuleMode: string
  }>
  paysEntry?: boolean | null
  paysAthleteFee?: boolean | null
}): RegistrationPlanForValidation {
  const disciplines = [
    ...new Set(input.registrations.map((row) => row.modality.discipline)),
  ]

  return {
    id: "plan-1",
    clubId: "club-1",
    eventId: "event-1",
    createdById: "user-1",
    status: "DRAFT",
    revision: 7,
    currentStep: 3,
    paysEntry: input.paysEntry ?? null,
    paysAthleteFee: input.paysAthleteFee ?? null,
    createdAt: now,
    updatedAt: now,
    club: {
      id: "club-1",
      name: "Club Uno",
      code: "C1",
    },
    event: {
      id: "event-1",
      seasonId: "season-1",
      name: "Nacional 2026",
      slug: "nacional-2026",
      disciplines,
      venue: "VIDENA",
      city: "Lima",
      startDate: new Date("2026-08-21T00:00:00.000Z"),
      endDate: new Date("2026-08-23T00:00:00.000Z"),
      registrationDeadline: new Date("2026-08-14T23:59:00.000Z"),
      status: "OPEN",
      description: null,
      createdAt: now,
      updatedAt: now,
      season: {
        id: "season-1",
        year: 2026,
        name: "Temporada 2026",
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-12-31T00:00:00.000Z"),
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
        categories: input.categories ?? [],
      },
      disciplineConfigs: input.disciplineConfigs ?? [],
    },
    athletes: input.roster.map((row) => ({
      id: `roster-${row.id}`,
      planId: "plan-1",
      athleteId: row.id,
      createdAt: now,
      athlete: row,
    })),
    registrations: input.registrations,
  } as RegistrationPlanForValidation
}

interface TxOverrides {
  clubAffiliations?: Array<{ discipline: string }>
  athleteAffiliations?: Array<{ athleteId: string; discipline: string }>
  occupied?: Array<{ modalityId: string }>
  confirmedDuplicates?: Array<{
    modalityId: string
    athleteId: string
    athlete: { firstNames: string; lastNames: string }
    registration: { id: string }
  }>
  /** Filas crudas que devolvería `tx.eventAthleteFee.findMany`, tal como las lee `coverageLookupFor`. */
  eventAthleteFees?: Array<{
    discipline: string
    athleteId: string
    orderItems: Array<{ order: { code: string } }>
  }>
}

function transactionMock(target: RegistrationPlanForValidation, overrides: TxOverrides = {}) {
  const pairs = target.registrations.flatMap((entry) =>
    entry.athletes.map((row) => ({
      athleteId: row.athleteId,
      discipline: entry.modality.discipline,
    }))
  )
  const clubDisciplines = [
    ...new Set(target.registrations.map((row) => row.modality.discipline)),
  ].map((discipline) => ({ discipline }))

  const clubAffiliationFindMany = vi
    .fn()
    .mockResolvedValue(overrides.clubAffiliations ?? clubDisciplines)
  const athleteAffiliationFindMany = vi
    .fn()
    .mockResolvedValue(overrides.athleteAffiliations ?? pairs)
  const occupiedCounts = new Map<string, number>()
  for (const row of overrides.occupied ?? []) {
    occupiedCounts.set(row.modalityId, (occupiedCounts.get(row.modalityId) ?? 0) + 1)
  }
  const registrationGroupBy = vi.fn().mockResolvedValue(
    [...occupiedCounts].map(([modalityId, count]) => ({
      modalityId,
      _count: { modalityId: count },
    }))
  )
  const duplicateFindMany = vi
    .fn()
    .mockResolvedValue(overrides.confirmedDuplicates ?? [])

  const tx = {
    clubAffiliation: { findMany: clubAffiliationFindMany },
    athleteAffiliation: { findMany: athleteAffiliationFindMany },
    registration: { groupBy: registrationGroupBy },
    registrationAthlete: { findMany: duplicateFindMany },
    eventAthleteFee: {
      findMany: vi.fn().mockResolvedValue(overrides.eventAthleteFees ?? []),
    },
  } as unknown as PlanTransactionClient

  return {
    tx,
    clubAffiliationFindMany,
    athleteAffiliationFindMany,
  }
}

async function validate(
  target: RegistrationPlanForValidation,
  overrides: TxOverrides = {}
) {
  const mocked = transactionMock(target, overrides)
  const result = await validateRegistrationPlanInTransaction(
    mocked.tx,
    {
      planId: target.id,
      clubId: target.clubId,
      expectedRevision: target.revision,
      mode: "CHECKOUT",
      now,
    },
    target
  )
  return { result, mocked }
}

describe("configuración explícita de ascenso", () => {
  const lowerCategory = category()

  it("acepta el año contiguo de la categoría inferior de artística", () => {
    expect(
      isValidCategoryUpgradeConfiguration(
        {
          discipline: "ARTISTIC_SWIMMING",
          allowsCategoryUpgrade: true,
          birthYearTo: 2012,
          categoryUpgradeBirthYear: 2013,
        },
        [lowerCategory]
      )
    ).toBe(true)
  })

  it.each([
    {
      label: "otra disciplina",
      modality: {
        discipline: "DIVING",
        allowsCategoryUpgrade: true,
        birthYearTo: 2012,
        categoryUpgradeBirthYear: 2013,
      },
      categories: [lowerCategory],
    },
    {
      label: "año no contiguo",
      modality: {
        discipline: "ARTISTIC_SWIMMING",
        allowsCategoryUpgrade: true,
        birthYearTo: 2012,
        categoryUpgradeBirthYear: 2014,
      },
      categories: [lowerCategory],
    },
    {
      label: "categoría inferior ausente",
      modality: {
        discipline: "ARTISTIC_SWIMMING",
        allowsCategoryUpgrade: true,
        birthYearTo: 2012,
        categoryUpgradeBirthYear: 2013,
      },
      categories: [],
    },
    {
      label: "regla apagada con año residual",
      modality: {
        discipline: "ARTISTIC_SWIMMING",
        allowsCategoryUpgrade: false,
        birthYearTo: 2012,
        categoryUpgradeBirthYear: 2013,
      },
      categories: [lowerCategory],
    },
  ])("rechaza $label", ({ modality: input, categories }) => {
    expect(isValidCategoryUpgradeConfiguration(input, categories)).toBe(false)
  })
})

describe("validación autoritativa de planillas", () => {
  it("cuenta reservas como deportistas pero cobra una vez por formación", async () => {
    const titular = athlete("titular")
    const reserva = athlete("reserva")
    const sinPrueba = athlete("sin-prueba")
    const team = modality("equipo", {
      minAthletes: 2,
      maxAthletes: 3,
      price: new Prisma.Decimal(350),
    })
    const target = plan({
      roster: [titular, reserva, sinPrueba],
      registrations: [
        registration("entry-1", team, [
          { athlete: titular },
          { athlete: reserva, isReserve: true },
        ]),
      ],
    })

    const { result } = await validate(target)

    expect(result.valid).toBe(true)
    expect(result.summary).toEqual({
      rosterAthleteCount: 3,
      registeredAthleteCount: 2,
      athletesWithoutEntries: 1,
      entryCount: 1,
      totalAmount: 350,
      currency: "PEN",
      // Sin configuración de disciplina el cobro sigue siendo por formación:
      // todo el importe cae en entriesAmount y no hay cuotas por deportista.
      entriesAmount: 350,
      athleteFeesAmount: 0,
      chargedAthleteFees: 0,
      coveredAthleteFees: 0,
      byDiscipline: [
        {
          discipline: "ARTISTIC_SWIMMING",
          chargesEntry: true,
          chargesAthleteFee: false,
          // Un solo concepto: nunca ofreció elegir, así que lo efectivamente
          // cobrado coincide con lo que cobra el evento.
          chargedEntry: true,
          chargedAthleteFee: false,
          entryCount: 1,
          athleteCount: 2,
          entriesAmount: 350,
          feesAmount: 0,
          subtotal: 350,
        },
      ],
    })
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "ATHLETE_WITHOUT_ENTRY",
        severity: "WARNING",
        athleteId: "sin-prueba",
      }),
    ])
  })

  it("suma el precio de cada formación, no el de cada integrante", async () => {
    const one = athlete("one")
    const two = athlete("two")
    const three = athlete("three")
    const individual = modality("individual", {
      price: new Prisma.Decimal(60),
    })
    const duet = modality("duet", {
      minAthletes: 2,
      maxAthletes: 2,
      price: new Prisma.Decimal(100),
    })
    const target = plan({
      roster: [one, two, three],
      registrations: [
        registration("entry-individual", individual, [{ athlete: one }]),
        registration("entry-duet", duet, [
          { athlete: two },
          { athlete: three },
        ]),
      ],
    })

    const { result } = await validate(target)

    expect(result.valid).toBe(true)
    expect(result.summary).toMatchObject({
      registeredAthleteCount: 3,
      entryCount: 2,
      totalAmount: 160,
    })
  })

  it("propaga edad, sexo, mixto e integrantes como errores de composición", async () => {
    const tooYoung = athlete("age", {
      birthDate: new Date("2014-01-01T00:00:00.000Z"),
    })
    const male = athlete("male", { sex: "M" })
    const femaleOne = athlete("female-1")
    const femaleTwo = athlete("female-2")
    const lone = athlete("lone")
    const target = plan({
      roster: [tooYoung, male, femaleOne, femaleTwo, lone],
      registrations: [
        registration(
          "entry-age",
          modality("age", { birthYearFrom: 2010, birthYearTo: 2013 }),
          [{ athlete: tooYoung }]
        ),
        registration(
          "entry-sex",
          modality("sex", { sexRule: "FEMALE" }),
          [{ athlete: male }]
        ),
        registration(
          "entry-mixed",
          modality("mixed", {
            sexRule: "MIXED",
            minAthletes: 2,
            maxAthletes: 2,
          }),
          [{ athlete: femaleOne }, { athlete: femaleTwo }]
        ),
        registration(
          "entry-size",
          modality("size", { minAthletes: 2, maxAthletes: 3 }),
          [{ athlete: lone }]
        ),
      ],
    })

    const { result } = await validate(target)
    const composition = result.issues.filter(
      (row) => row.code === "COMPOSITION_INVALID"
    )

    expect(result.valid).toBe(false)
    expect(composition).toHaveLength(4)
    const messages = composition.map((row) => row.message).join("\n")
    expect(messages).toMatch(/esta prueba es para nacidos entre 2010 y 2013/)
    expect(messages).toMatch(/Esta prueba es solo para damas\./)
    expect(messages).toMatch(/requiere al menos un varón y una dama/)
    expect(messages).toMatch(/requiere de 2 a 3 integrantes; marcaste 1/)
  })

  it("detecta duplicados entre formaciones y contra una orden confirmada", async () => {
    const repeated = athlete("repeated")
    const solo = modality("solo")
    const target = plan({
      roster: [repeated],
      registrations: [
        registration("entry-1", solo, [{ athlete: repeated }]),
        registration("entry-2", solo, [{ athlete: repeated }]),
      ],
    })

    const { result } = await validate(target, {
      confirmedDuplicates: [
        {
          modalityId: solo.id,
          athleteId: repeated.id,
          athlete: {
            firstNames: repeated.firstNames,
            lastNames: repeated.lastNames,
          },
          registration: { id: "paid-entry" },
        },
      ],
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_ENTRY" }),
        expect.objectContaining({ code: "DUPLICATE_CONFIRMED_ENTRY" }),
      ])
    )
  })

  it("acepta el ascenso configurado y lo informa como advertencia", async () => {
    const promoted = athlete("promoted", {
      birthDate: new Date("2013-05-04T00:00:00.000Z"),
    })
    const solo = modality("solo-upgrade", {
      birthYearFrom: 2010,
      birthYearTo: 2012,
      allowsCategoryUpgrade: true,
      categoryUpgradeBirthYear: 2013,
    })
    const target = plan({
      roster: [promoted],
      registrations: [
        registration("entry-upgrade", solo, [{ athlete: promoted }]),
      ],
      categories: [category()],
    })

    const { result } = await validate(target)

    expect(result.valid).toBe(true)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "CATEGORY_UPGRADE_USED",
        severity: "WARNING",
        athleteId: promoted.id,
      })
    )
    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ code: "COMPOSITION_INVALID" })
    )
  })

  it("exige afiliaciones que cubran todas las fechas del evento", async () => {
    const swimmer = athlete("swimmer")
    const solo = modality("solo-affiliation")
    const target = plan({
      roster: [swimmer],
      registrations: [registration("entry-1", solo, [{ athlete: swimmer }])],
    })

    const { result, mocked } = await validate(target, {
      clubAffiliations: [],
      athleteAffiliations: [],
    })

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CLUB_AFFILIATION_REQUIRED" }),
        expect.objectContaining({ code: "ATHLETE_AFFILIATION_REQUIRED" }),
      ])
    )
    expect(mocked.clubAffiliationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          validFrom: { lte: target.event!.startDate },
          validTo: { gte: target.event!.endDate },
        }),
      })
    )
    expect(mocked.athleteAffiliationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          validFrom: { lte: target.event!.startDate },
          validTo: { gte: target.event!.endDate },
        }),
      })
    )
  })
})

describe("elección de conceptos de cobro", () => {
  // Tipado explícito: sin él, TS infiere athleteFee como string a secas (por el
  // literal "60.00") y el test que lo apaga con athleteFee: null no compila.
  const POLO_AMBOS: Array<{
    discipline: string
    chargesEntry: boolean
    chargesAthleteFee: boolean
    athleteFee: string | null
    ageRuleMode: string
  }> = [
    {
      discipline: "WATER_POLO",
      chargesEntry: true,
      chargesAthleteFee: true,
      athleteFee: "60.00",
      ageRuleMode: "RANGE",
    },
  ]

  function planteles(
    disciplineConfigs: typeof POLO_AMBOS,
    choice: { paysEntry?: boolean | null; paysAthleteFee?: boolean | null }
  ) {
    const jugador = athlete("j1", { disciplines: ["WATER_POLO"] })
    const plantel = modality("m-polo", {
      discipline: "WATER_POLO",
      name: "Plantel",
      minAthletes: 1,
      maxAthletes: 14,
      price: new Prisma.Decimal(500),
    })
    return plan({
      roster: [jugador],
      registrations: [registration("r1", plantel, [{ athlete: jugador }])],
      disciplineConfigs,
      ...choice,
    })
  }

  it("bloquea la planilla que no eligió pagar ningún concepto", async () => {
    const target = planteles(POLO_AMBOS, {
      paysEntry: false,
      paysAthleteFee: false,
    })
    const { tx } = transactionMock(target)

    const result = await validateRegistrationPlanInTransaction(
      tx,
      { planId: "plan-1", clubId: "club-1", now },
      target
    )

    expect(result.valid).toBe(false)
    expect(
      result.issues.find((row) => row.code === "CHARGE_SELECTION_REQUIRED")
    ).toMatchObject({ severity: "ERROR", action: "EDIT_ENTRY" })
  })

  // El evento cobra un solo concepto (acá WATER_POLO con chargesAthleteFee en
  // false): nunca hubo elección que ofrecer, así que paysEntry=false no tiene
  // disciplina donde aplicarse. La bandera se ignora y el cobro se mantiene
  // -distinto del caso de la cuota ya cubierta (test de abajo), que tampoco
  // bloquea pero por otra razón.
  it("ignora la bandera apagada cuando el evento cobra un solo concepto: no hay elección que ofrecer", async () => {
    const target = planteles(
      [{ ...POLO_AMBOS[0], chargesAthleteFee: false, athleteFee: null }],
      { paysEntry: false }
    )
    const { tx } = transactionMock(target)

    const result = await validateRegistrationPlanInTransaction(
      tx,
      { planId: "plan-1", clubId: "club-1", now },
      target
    )

    expect(result.valid).toBe(true)
    expect(
      result.issues.find((row) => row.code === "CHARGE_SELECTION_REQUIRED")
    ).toBeUndefined()
    // El importe sigue siendo el del único concepto que cobra el evento, no
    // cero: sin este expect el test pasaría igual si el arreglo hubiera roto
    // el cobro en vez de preservarlo.
    expect(result.summary.totalAmount).toBe(500)
  })

  it("en una planilla multidisciplina, apagar banderas no toca a las disciplinas que no ofrecen elegir", async () => {
    // Clavados solo cobra cuota por deportista; polo solo cobra formación.
    // Ninguna fila de byDiscipline cobra los dos conceptos a la vez, así que
    // paysEntry/paysAthleteFee no tienen disciplina donde aplicarse: las dos
    // se siguen cobrando cada una por su cuenta y la planilla no puede llegar
    // a cero por esta vía.
    const jugador = athlete("j-polo", { disciplines: ["WATER_POLO"] })
    const clavadista = athlete("j-diving", { disciplines: ["DIVING"] })
    const plantel = modality("m-polo-multi", {
      discipline: "WATER_POLO",
      name: "Plantel",
      minAthletes: 1,
      maxAthletes: 14,
      price: new Prisma.Decimal(500),
    })
    const prueba = modality("m-diving-multi", {
      discipline: "DIVING",
      name: "Individual",
      price: new Prisma.Decimal(60),
    })
    const target = plan({
      roster: [jugador, clavadista],
      registrations: [
        registration("r-polo", plantel, [{ athlete: jugador }]),
        registration("r-diving", prueba, [{ athlete: clavadista }]),
      ],
      disciplineConfigs: [
        {
          discipline: "WATER_POLO",
          chargesEntry: true,
          chargesAthleteFee: false,
          athleteFee: null,
          ageRuleMode: "RANGE",
        },
        {
          discipline: "DIVING",
          chargesEntry: false,
          chargesAthleteFee: true,
          athleteFee: "60.00",
          ageRuleMode: "RANGE",
        },
      ],
      paysEntry: false,
      paysAthleteFee: false,
    })
    const { tx } = transactionMock(target)

    const result = await validateRegistrationPlanInTransaction(
      tx,
      { planId: "plan-1", clubId: "club-1", now },
      target
    )

    expect(result.valid).toBe(true)
    expect(
      result.issues.find((row) => row.code === "CHARGE_SELECTION_REQUIRED")
    ).toBeUndefined()

    const polo = result.summary.byDiscipline.find(
      (row) => row.discipline === "WATER_POLO"
    )!
    const diving = result.summary.byDiscipline.find(
      (row) => row.discipline === "DIVING"
    )!
    // La formación de polo se sigue cobrando: paysEntry=false estaba pensado
    // para una disciplina que ofrece elegir, y polo acá no es esa disciplina.
    expect(polo.chargedEntry).toBe(true)
    expect(polo.entriesAmount).toBe(500)
    // La cuota de clavados también, por la misma razón con paysAthleteFee.
    expect(diving.chargedAthleteFee).toBe(true)
    expect(diving.feesAmount).toBe(60)

    // El total es la suma de las dos, no cero.
    expect(result.summary.totalAmount).toBe(560)
  })

  it("en una planilla multidisciplina, una disciplina que ofrece elegir y queda en cero bloquea aunque otra sin elección siga cobrando", async () => {
    // Regresión: la guarda anterior era un some() sobre TODAS las
    // disciplinas, así que bastaba con que UNA cobrara algo para que la
    // planilla pasara. Acá polo ofrece elegir (cobra los dos conceptos) y el
    // club apagó los dos -queda en S/ 0, sin cuotas- pero clavados sigue
    // cobrando su formación porque no ofrece elegir. La planilla tiene que
    // bloquear igual: la guarda es por disciplina, no global.
    const jugador = athlete("j-polo-block", { disciplines: ["WATER_POLO"] })
    const clavadista = athlete("j-diving-block", { disciplines: ["DIVING"] })
    const plantel = modality("m-polo-block", {
      discipline: "WATER_POLO",
      name: "Plantel",
      minAthletes: 1,
      maxAthletes: 14,
      price: new Prisma.Decimal(500),
    })
    const prueba = modality("m-diving-block", {
      discipline: "DIVING",
      name: "Individual",
      price: new Prisma.Decimal(60),
    })
    const target = plan({
      roster: [jugador, clavadista],
      registrations: [
        registration("r-polo-block", plantel, [{ athlete: jugador }]),
        registration("r-diving-block", prueba, [{ athlete: clavadista }]),
      ],
      disciplineConfigs: [
        {
          discipline: "WATER_POLO",
          chargesEntry: true,
          chargesAthleteFee: true,
          athleteFee: "60.00",
          ageRuleMode: "RANGE",
        },
        {
          discipline: "DIVING",
          chargesEntry: true,
          chargesAthleteFee: false,
          athleteFee: null,
          ageRuleMode: "RANGE",
        },
      ],
      paysEntry: false,
      paysAthleteFee: false,
    })
    const { tx } = transactionMock(target)

    const result = await validateRegistrationPlanInTransaction(
      tx,
      { planId: "plan-1", clubId: "club-1", now },
      target
    )

    expect(result.valid).toBe(false)
    expect(
      result.issues.find((row) => row.code === "CHARGE_SELECTION_REQUIRED")
    ).toMatchObject({ severity: "ERROR", action: "EDIT_ENTRY" })

    const polo = result.summary.byDiscipline.find(
      (row) => row.discipline === "WATER_POLO"
    )!
    const diving = result.summary.byDiscipline.find(
      (row) => row.discipline === "DIVING"
    )!
    // Polo quedó en S/ 0: los dos conceptos apagados por el club ahí.
    expect(polo.chargedEntry).toBe(false)
    expect(polo.chargedAthleteFee).toBe(false)
    // Clavados sigue cobrando su formación, importe incluido: no basta con
    // que el error aparezca, el cobro de la disciplina que sí puede cobrar
    // tiene que seguir de pie.
    expect(diving.chargedEntry).toBe(true)
    expect(diving.entriesAmount).toBe(60)
    expect(result.summary.totalAmount).toBe(60)
  })

  it("no exige elección cuando la única cuota que cobra el evento ya está cubierta por otra orden", async () => {
    // El concepto sigue prendido (nadie lo apagó): el total en 0 es porque ya se
    // pagó en otra orden, no porque el club haya elegido no pagar nada.
    const target = planteles([{ ...POLO_AMBOS[0], chargesEntry: false }], {})
    const { tx } = transactionMock(target, {
      eventAthleteFees: [
        {
          discipline: "WATER_POLO",
          athleteId: "j1",
          orderItems: [{ order: { code: "ORD-1" } }],
        },
      ],
    })

    const result = await validateRegistrationPlanInTransaction(
      tx,
      { planId: "plan-1", clubId: "club-1", now },
      target
    )

    expect(result.summary.totalAmount).toBe(0)
    expect(
      result.issues.some((row) => row.code === "CHARGE_SELECTION_REQUIRED")
    ).toBe(false)
  })

  it("una planilla sin elección explícita paga los dos conceptos", async () => {
    const target = planteles(POLO_AMBOS, {})
    const { tx } = transactionMock(target)

    const result = await validateRegistrationPlanInTransaction(
      tx,
      { planId: "plan-1", clubId: "club-1", now },
      target
    )

    expect(result.summary.totalAmount).toBe(560)
    expect(
      result.issues.some((row) => row.code === "CHARGE_SELECTION_REQUIRED")
    ).toBe(false)
  })
})
