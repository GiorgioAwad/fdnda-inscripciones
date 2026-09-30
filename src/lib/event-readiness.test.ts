import { describe, expect, it } from "vitest"
import {
  eventReadiness,
  modalityDisplayName,
  type ReadinessInput,
  type ReadinessModality,
} from "./event-readiness"

const NOW = new Date("2026-05-01T12:00:00-05:00")

function modality(overrides: Partial<ReadinessModality> = {}): ReadinessModality {
  return {
    name: "Trampolín 3m",
    category: "Grupo C — Damas",
    discipline: "DIVING",
    isActive: true,
    price: 0,
    pricePerMatch: null,
    matchesPerTeam: null,
    expectedTeams: null,
    birthYearFrom: 2013,
    birthYearTo: 2014,
    allowsCategoryUpgrade: false,
    categoryUpgradeBirthYear: null,
    ...overrides,
  }
}

function event(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    registrationDeadline: new Date("2026-06-01T23:59:00-05:00"),
    isLeague: false,
    disciplines: ["DIVING"],
    disciplineConfigs: [
      {
        discipline: "DIVING",
        chargesEntry: false,
        chargesAthleteFee: true,
        athleteFee: "80.00",
        ageRuleMode: "RANGE",
      },
    ],
    season: { name: "Temporada 2026", feeDisciplines: ["DIVING"] },
    modalities: [modality()],
    ...overrides,
  }
}

function keysOf(input: ReadinessInput) {
  return eventReadiness(input, NOW).missing.map((item) => item.key)
}

describe("eventReadiness", () => {
  it("una competencia completa está lista y lista cada requisito que aplica", () => {
    const readiness = eventReadiness(event(), NOW)
    expect(readiness.ready).toBe(true)
    expect(readiness.missing).toEqual([])
    expect(readiness.checks.map((item) => item.key)).toEqual([
      "SEASON",
      "DEADLINE",
      "ACTIVE_MODALITY",
      "ATHLETE_FEE",
      "AFFILIATION_FEE",
    ])
  })

  it("sin temporada falla primero y no revisa la cuota de afiliación", () => {
    const readiness = eventReadiness(event({ season: null }), NOW)
    expect(readiness.missing[0].key).toBe("SEASON")
    expect(readiness.checks.some((item) => item.key === "AFFILIATION_FEE")).toBe(false)
  })

  it("un cierre de inscripciones vencido o igual a ahora bloquea la apertura", () => {
    expect(keysOf(event({ registrationDeadline: new Date(NOW.getTime() - 1) }))).toEqual([
      "DEADLINE",
    ])
    expect(keysOf(event({ registrationDeadline: NOW }))).toEqual(["DEADLINE"])
  })

  it("distingue una competencia sin pruebas de una con todas desactivadas", () => {
    const empty = eventReadiness(event({ modalities: [] }), NOW)
    expect(empty.missing.map((item) => item.key)).toEqual(["ACTIVE_MODALITY"])
    expect(empty.missing[0].problem).toMatch(/Agrega al menos una prueba/)

    const inactive = eventReadiness(
      event({ modalities: [modality({ isActive: false })] }),
      NOW
    )
    expect(inactive.missing[0].problem).toMatch(/Todas las pruebas están desactivadas/)
    expect(inactive.missing[0].label).toBe("Al menos una prueba activa (0 de 1 activas)")
  })

  it("las pruebas inactivas no cuentan para las demás reglas", () => {
    const readiness = eventReadiness(
      event({
        modalities: [
          modality(),
          modality({ isActive: false, discipline: "WATER_POLO" }),
        ],
      }),
      NOW
    )
    expect(readiness.ready).toBe(true)
  })

  it("en una liga exige precio por partido, partidos y planteles coherentes", () => {
    const poloConfig = {
      discipline: "WATER_POLO",
      chargesEntry: true,
      chargesAthleteFee: false,
      athleteFee: null,
      ageRuleMode: "RANGE",
    }
    const base = {
      isLeague: true,
      disciplines: ["WATER_POLO"],
      disciplineConfigs: [poloConfig],
      season: { name: "Temporada 2026", feeDisciplines: ["WATER_POLO"] },
    }
    const complete = modality({
      name: "Plantel",
      category: "Sub-16 — Varones",
      discipline: "WATER_POLO",
      price: 200,
      pricePerMatch: 50,
      matchesPerTeam: 4,
      expectedTeams: 3,
    })
    expect(eventReadiness(event({ ...base, modalities: [complete] }), NOW).ready).toBe(true)

    const withoutTeams = eventReadiness(
      event({ ...base, modalities: [{ ...complete, expectedTeams: null }] }),
      NOW
    )
    expect(withoutTeams.missing.map((item) => item.key)).toEqual(["LEAGUE"])
    expect(withoutTeams.missing[0].problem).toContain("«Plantel · Sub-16 — Varones»")

    // Un precio final que no sale de precio por partido × partidos es una
    // prueba editada a mano fuera de la liga.
    const wrongPrice = eventReadiness(
      event({ ...base, modalities: [{ ...complete, price: 150 }] }),
      NOW
    )
    expect(wrongPrice.missing.map((item) => item.key)).toEqual(["LEAGUE"])
  })

  it("una cuota de competencia por deportista en cero bloquea la apertura", () => {
    const readiness = eventReadiness(
      event({
        disciplineConfigs: [
          {
            discipline: "DIVING",
            chargesEntry: false,
            chargesAthleteFee: true,
            athleteFee: "0",
            ageRuleMode: "RANGE",
          },
        ],
      }),
      NOW
    )
    expect(readiness.missing.map((item) => item.key)).toEqual(["ATHLETE_FEE"])
    expect(readiness.missing[0].problem).toMatch(/Clavados debe ser mayor que S\/ 0/)
  })

  it("no muestra el requisito de cuota cuando la disciplina cobra solo por formación", () => {
    const readiness = eventReadiness(
      event({
        disciplineConfigs: [
          {
            discipline: "DIVING",
            chargesEntry: true,
            chargesAthleteFee: false,
            athleteFee: null,
            ageRuleMode: "RANGE",
          },
        ],
      }),
      NOW
    )
    expect(readiness.checks.some((item) => item.key === "ATHLETE_FEE")).toBe(false)
  })

  it("en Sub-N una prueba con año «hasta» no puede abrir", () => {
    const subN = {
      discipline: "WATER_POLO",
      chargesEntry: true,
      chargesAthleteFee: false,
      athleteFee: null,
      ageRuleMode: "MAX_AGE_ONLY",
    }
    const base = {
      disciplines: ["WATER_POLO"],
      disciplineConfigs: [subN],
      season: { name: "Temporada 2026", feeDisciplines: ["WATER_POLO"] },
    }
    const ok = modality({ discipline: "WATER_POLO", birthYearFrom: 2009, birthYearTo: null })
    expect(eventReadiness(event({ ...base, modalities: [ok] }), NOW).ready).toBe(true)
    expect(
      keysOf(event({ ...base, modalities: [{ ...ok, birthYearTo: 2010 }] }))
    ).toEqual(["AGE_RULE"])
  })

  it("exige la cuota de afiliación de la disciplina en la temporada", () => {
    const readiness = eventReadiness(
      event({ season: { name: "Temporada 2026", feeDisciplines: [] } }),
      NOW
    )
    expect(readiness.missing.map((item) => item.key)).toEqual(["AFFILIATION_FEE"])
    expect(readiness.missing[0].problem).toBe(
      "«Temporada 2026» no tiene cuota de afiliación de Clavados. Configúrala en Temporadas."
    )
  })

  it("marca pruebas de otra disciplina y «Sube de categoría» mal configurado", () => {
    expect(
      keysOf(event({ modalities: [modality(), modality({ discipline: "WATER_POLO" })] }))
    ).toEqual(["MODALITY_DISCIPLINE", "AFFILIATION_FEE"])

    const artistic = {
      disciplines: ["ARTISTIC_SWIMMING"],
      disciplineConfigs: [],
      season: { name: "Temporada 2026", feeDisciplines: ["ARTISTIC_SWIMMING"] },
    }
    const solo = modality({ name: "Solo Libre", discipline: "ARTISTIC_SWIMMING" })
    expect(
      keysOf(
        event({
          ...artistic,
          modalities: [{ ...solo, allowsCategoryUpgrade: true, categoryUpgradeBirthYear: 2015 }],
        })
      )
    ).toEqual([])
    expect(
      keysOf(event({ ...artistic, modalities: [{ ...solo, allowsCategoryUpgrade: true }] }))
    ).toEqual(["CATEGORY_UPGRADE"])
  })

  it("el primer requisito que falta es el que devuelve el servidor, en orden fijo", () => {
    const readiness = eventReadiness(
      event({
        season: null,
        registrationDeadline: new Date(NOW.getTime() - 1),
        modalities: [],
      }),
      NOW
    )
    expect(readiness.missing.map((item) => item.key)).toEqual([
      "SEASON",
      "DEADLINE",
      "ACTIVE_MODALITY",
    ])
  })
})

describe("modalityDisplayName", () => {
  it("une nombre y categoría, y omite la categoría vacía", () => {
    expect(modalityDisplayName({ name: "Plataforma", category: "Grupo A — Varones" })).toBe(
      "Plataforma · Grupo A — Varones"
    )
    expect(modalityDisplayName({ name: "Plataforma", category: null })).toBe("Plataforma")
  })
})
