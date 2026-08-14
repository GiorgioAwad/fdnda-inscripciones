import { describe, expect, it } from "vitest"
import { entryChargeSuffix } from "./entry-charge-note"
import { buildOrderSummary } from "./order-summary"

const EVENT = {
  id: "event-1",
  name: "Nacional 2026",
  slug: "nacional-2026",
  venue: "VIDENA",
  city: "Lima",
  startDate: "2026-08-20T00:00:00.000Z",
  endDate: "2026-08-22T00:00:00.000Z",
  registrationDeadline: "2026-08-10T23:59:59.000Z",
  season: { id: "season-1", year: 2026, name: "Temporada 2026" },
}

const CLUB = { id: "club-1", name: "Club Delfines", code: "DEL" }

function athlete(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    firstNames: "Ana",
    lastNames: "Pérez",
    docType: "DNI",
    docNumber: "70000001",
    birthDate: "2012-05-10T00:00:00.000Z",
    sex: "F",
    disciplines: ["ARTISTIC_SWIMMING"],
    isReserve: false,
    ...overrides,
  }
}

function entryItem(overrides: {
  id: string
  discipline?: string
  name?: string
  category?: string | null
  unitPrice?: unknown
  description?: string
  athletes?: ReturnType<typeof athlete>[]
  allowsCategoryUpgrade?: boolean
  categoryUpgradeBirthYear?: number | null
  birthYearFrom?: number | null
  birthYearTo?: number | null
}) {
  return {
    id: overrides.id,
    description: overrides.description ?? "descripción legada",
    unitPrice: overrides.unitPrice ?? "150.00",
    registrationSnapshot: {
      version: 1,
      capturedAt: "2026-08-03T18:00:00.000Z",
      plan: { id: "plan-1", revision: 7 },
      club: CLUB,
      event: EVENT,
      modality: {
        id: `mod-${overrides.id}`,
        discipline: overrides.discipline ?? "ARTISTIC_SWIMMING",
        name: overrides.name ?? "Dueto libre",
        category: overrides.category ?? "Juvenil",
        sexRule: "FEMALE",
        birthYearFrom: overrides.birthYearFrom ?? 2010,
        birthYearTo: overrides.birthYearTo ?? 2012,
        allowsCategoryUpgrade: overrides.allowsCategoryUpgrade ?? false,
        categoryUpgradeBirthYear: overrides.categoryUpgradeBirthYear ?? null,
        minAthletes: 1,
        maxAthletes: 2,
        price: "150.00",
        capacity: null,
      },
      registration: {
        id: `reg-${overrides.id}`,
        athletes: overrides.athletes ?? [athlete()],
      },
    },
  }
}

function feeItem(overrides: { id: string; unitPrice?: unknown; athleteId?: string }) {
  return {
    id: overrides.id,
    description: "descripción legada",
    unitPrice: overrides.unitPrice ?? "80.00",
    registrationSnapshot: {
      version: 2,
      kind: "ATHLETE_FEE",
      capturedAt: "2026-08-03T18:00:00.000Z",
      plan: { id: "plan-1", revision: 7 },
      club: CLUB,
      event: EVENT,
      discipline: "DIVING",
      fee: "80.00",
      athlete: {
        id: overrides.athleteId ?? "a1",
        firstNames: "Ana",
        lastNames: "Pérez",
        docType: "DNI",
        docNumber: "70000001",
        birthDate: "2012-05-10T00:00:00.000Z",
        sex: "F",
      },
    },
  }
}

describe("buildOrderSummary", () => {
  it("toma la cabecera del evento y el club del snapshot congelado", () => {
    const summary = buildOrderSummary([entryItem({ id: "i1" })])

    expect(summary.clubName).toBe("Club Delfines")
    expect(summary.event).toEqual({
      name: "Nacional 2026",
      venue: "VIDENA",
      city: "Lima",
      startDate: EVENT.startDate,
      endDate: EVENT.endDate,
      seasonName: "Temporada 2026",
    })
  })

  it("agrupa por disciplina y ordena de forma estable", () => {
    const summary = buildOrderSummary([
      entryItem({ id: "i1", discipline: "WATER_POLO", name: "Plantel" }),
      entryItem({ id: "i2", discipline: "DIVING", name: "Trampolín 3m" }),
      entryItem({ id: "i3", discipline: "ARTISTIC_SWIMMING" }),
    ])

    // Orden de DISCIPLINE_VALUES, no el de llegada de los ítems.
    expect(summary.disciplines.map((row) => row.discipline)).toEqual([
      "DIVING",
      "ARTISTIC_SWIMMING",
      "WATER_POLO",
    ])
  })

  it("suma lo cobrado por ítem, no el precio de lista de la prueba", () => {
    const summary = buildOrderSummary([
      // Clavados con cuota fija: la formación va a 0 aunque su prueba liste 150.
      entryItem({ id: "i1", discipline: "DIVING", unitPrice: "0.00" }),
      feeItem({ id: "i2" }),
    ])

    expect(summary.totals.amount).toBe(80)
    const diving = summary.disciplines[0]
    expect(diving.subtotal).toBe(80)
    expect(diving.rosters[0].entries[0].amount).toBe(0)
    expect(diving.athleteFees[0].amount).toBe(80)
  })

  it("cuenta deportistas distintos, no apariciones", () => {
    const summary = buildOrderSummary([
      entryItem({ id: "i1", name: "Solo" }),
      entryItem({ id: "i2", name: "Figuras" }),
    ])

    expect(summary.totals.entryCount).toBe(2)
    expect(summary.totals.athleteCount).toBe(1)
    expect(summary.disciplines[0].athleteCount).toBe(1)
  })

  it("conserva titulares y reservas con su documento y año", () => {
    const summary = buildOrderSummary([
      entryItem({
        id: "i1",
        athletes: [
          athlete(),
          athlete({ id: "a2", firstNames: "Luz", lastNames: "Silva", isReserve: true }),
        ],
      }),
    ])

    const athletes = summary.disciplines[0].rosters[0].entries[0].athletes
    expect(athletes).toHaveLength(2)
    expect(athletes[0]).toMatchObject({
      name: "Pérez, Ana",
      docNumber: "70000001",
      birthYear: 2012,
      isReserve: false,
    })
    expect(athletes[1]).toMatchObject({ name: "Silva, Luz", isReserve: true })
  })

  it("marca a quien compite subiendo de categoría", () => {
    const summary = buildOrderSummary([
      entryItem({
        id: "i1",
        birthYearFrom: 2010,
        birthYearTo: 2012,
        allowsCategoryUpgrade: true,
        categoryUpgradeBirthYear: 2013,
        athletes: [athlete({ birthDate: "2013-02-01T00:00:00.000Z" })],
      }),
    ])

    expect(summary.disciplines[0].rosters[0].entries[0].athletes[0].competesUp).toBe(
      true
    )
  })

  it("no marca ascenso cuando la prueba no lo admite", () => {
    const summary = buildOrderSummary([
      entryItem({
        id: "i1",
        allowsCategoryUpgrade: false,
        categoryUpgradeBirthYear: 2013,
        athletes: [athlete({ birthDate: "2013-02-01T00:00:00.000Z" })],
      }),
    ])

    expect(summary.disciplines[0].rosters[0].entries[0].athletes[0].competesUp).toBe(
      false
    )
  })

  it("junta en una formación las pruebas que repiten los mismos deportistas", () => {
    const summary = buildOrderSummary([
      entryItem({ id: "i1", discipline: "DIVING", name: "Trampolín 3m", unitPrice: "50.00" }),
      entryItem({ id: "i2", discipline: "DIVING", name: "Plataforma", unitPrice: "50.00" }),
      entryItem({ id: "i3", discipline: "DIVING", name: "Trampolín 1m", unitPrice: "50.00" }),
    ])

    const rosters = summary.disciplines[0].rosters
    expect(rosters).toHaveLength(1)
    expect(rosters[0].athletes.map((a) => a.name)).toEqual(["Pérez, Ana"])
    // Las pruebas quedan ordenadas por nombre dentro de la formación.
    expect(rosters[0].entries.map((entry) => entry.modalityName)).toEqual([
      "Plataforma",
      "Trampolín 1m",
      "Trampolín 3m",
    ])
    expect(rosters[0].subtotal).toBe(150)
    expect(summary.disciplines[0].entryCount).toBe(3)
    expect(summary.totals.entryCount).toBe(3)
  })

  it("separa formaciones con distinto plantel y las ordena por deportista", () => {
    const luz = athlete({ id: "a2", firstNames: "Luz", lastNames: "Silva" })
    const summary = buildOrderSummary([
      entryItem({ id: "i1", name: "Solo libre", athletes: [luz] }),
      entryItem({ id: "i2", name: "Dueto libre", athletes: [athlete(), luz] }),
      // Mismo dueto en otra prueba, guardado al revés: sigue siendo la misma gente.
      entryItem({ id: "i3", name: "Dueto técnico", athletes: [luz, athlete()] }),
    ])

    const rosters = summary.disciplines[0].rosters
    expect(rosters.map((roster) => roster.athletes.map((a) => a.name))).toEqual([
      ["Pérez, Ana", "Silva, Luz"],
      ["Silva, Luz"],
    ])
    expect(rosters[0].entries.map((entry) => entry.itemId)).toEqual(["i2", "i3"])
    expect(rosters[1].entries.map((entry) => entry.itemId)).toEqual(["i1"])
  })

  it("no pierde los ítems sin snapshot legible", () => {
    const summary = buildOrderSummary([
      { id: "i1", description: "Ítem legado", unitPrice: "45.00" },
      entryItem({ id: "i2" }),
    ])

    expect(summary.legacyItems).toEqual([
      { itemId: "i1", description: "Ítem legado", amount: 45 },
    ])
    expect(summary.totals.amount).toBe(195)
  })

  it("una orden solo de ítems legados no inventa cabecera", () => {
    const summary = buildOrderSummary([
      { id: "i1", description: "Ítem legado", unitPrice: "45.00" },
    ])

    expect(summary.event).toBeNull()
    expect(summary.clubName).toBeNull()
    expect(summary.disciplines).toEqual([])
  })

  // La nota de por qué una formación vale S/ 0 no vive en el snapshot JSON
  // (no guarda chargesEntry/paysEntry): se relee del sufijo que
  // buildRegistrationDescription grabó en `description` al crear la orden.
  describe("nota de por qué una formación vale S/ 0", () => {
    it("lee IN_ATHLETE_FEE del sufijo congelado en la descripción", () => {
      const summary = buildOrderSummary([
        entryItem({
          id: "i1",
          discipline: "DIVING",
          unitPrice: "0.00",
          description: `Nacional 2026 | Clavados — Trampolín 3m | Ana Pérez${entryChargeSuffix("IN_ATHLETE_FEE")}`,
        }),
      ])

      expect(summary.disciplines[0].rosters[0].entries[0].note).toBe(
        "IN_ATHLETE_FEE"
      )
    })

    it("lee CLUB_PAYS_PER_ATHLETE del sufijo congelado en la descripción", () => {
      const summary = buildOrderSummary([
        entryItem({
          id: "i1",
          discipline: "WATER_POLO",
          unitPrice: "0.00",
          description: `Nacional 2026 | Polo acuático — Plantel | Ana Pérez${entryChargeSuffix("CLUB_PAYS_PER_ATHLETE")}`,
        }),
      ])

      expect(summary.disciplines[0].rosters[0].entries[0].note).toBe(
        "CLUB_PAYS_PER_ATHLETE"
      )
    })

    it("una descripción sin sufijo se lee como CHARGED", () => {
      const summary = buildOrderSummary([entryItem({ id: "i1" })])

      expect(summary.disciplines[0].rosters[0].entries[0].note).toBe("CHARGED")
    })
  })
})
