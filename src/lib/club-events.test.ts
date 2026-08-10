import { beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock se iza al tope del archivo, así que los dobles tienen que crearse en
// vi.hoisted para existir cuando la fábrica corre.
const { season, clubAffiliation } = vi.hoisted(() => ({
  season: { findFirst: vi.fn() },
  clubAffiliation: { findMany: vi.fn() },
}))

vi.mock("./prisma", () => ({ prisma: { season, clubAffiliation } }))

import { clubEventWhere, getClubEventScope } from "./club-events"

const CURRENT_SEASON = { id: "season-1", year: 2026, name: "Temporada 2026" }

beforeEach(() => {
  season.findFirst.mockReset()
  clubAffiliation.findMany.mockReset()
  season.findFirst.mockResolvedValue(CURRENT_SEASON)
})

describe("clubEventWhere", () => {
  const now = new Date("2026-08-05T12:00:00.000Z")

  it("filtra por intersección de disciplinas", () => {
    expect(clubEventWhere(["DIVING", "WATER_POLO"])).toEqual({
      disciplines: { hasSome: ["DIVING", "WATER_POLO"] },
    })
  })

  it("acumula los filtros pedidos sin inventar otros", () => {
    expect(
      clubEventWhere(["DIVING"], {
        requireOpen: true,
        requireFutureDeadline: true,
        requireSeason: true,
        now,
      })
    ).toEqual({
      disciplines: { hasSome: ["DIVING"] },
      status: "OPEN",
      registrationDeadline: { gte: now },
      seasonId: { not: null },
    })
  })

  it("no agrega el filtro de plazo cuando no se pide", () => {
    const where = clubEventWhere(["DIVING"], { requireOpen: true, now })
    expect(where).not.toHaveProperty("registrationDeadline")
  })
})

describe("getClubEventScope", () => {
  it("incluye las disciplinas con afiliación ACTIVA y PENDIENTE", async () => {
    clubAffiliation.findMany.mockResolvedValue([
      { discipline: "WATER_POLO" },
      { discipline: "DIVING" },
    ])

    const scope = await getClubEventScope("club-1")

    expect(clubAffiliation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clubId: "club-1",
          seasonId: "season-1",
          status: { in: ["ACTIVE", "PENDING"] },
        }),
      })
    )
    // Orden estable según DISCIPLINE_VALUES, no según lo que devuelva la base.
    expect(scope.disciplines).toEqual(["DIVING", "WATER_POLO"])
    expect(scope.hasAnyAffiliation).toBe(true)
    expect(scope.season).toEqual(CURRENT_SEASON)
  })

  it("un club sin afiliaciones no ve ninguna competencia", async () => {
    clubAffiliation.findMany.mockResolvedValue([])

    const scope = await getClubEventScope("club-1")

    expect(scope.disciplines).toEqual([])
    expect(scope.hasAnyAffiliation).toBe(false)
    // La temporada sí existe: distingue "no me afilié" de "no hay temporada".
    expect(scope.season).toEqual(CURRENT_SEASON)
  })

  it("sin temporada vigente no consulta afiliaciones", async () => {
    season.findFirst.mockResolvedValue(null)

    const scope = await getClubEventScope("club-1")

    expect(clubAffiliation.findMany).not.toHaveBeenCalled()
    expect(scope.season).toBeNull()
    expect(scope.disciplines).toEqual([])
  })
})
