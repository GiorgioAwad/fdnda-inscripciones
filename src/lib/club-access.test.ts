import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  planFindFirst: vi.fn(),
  athleteCount: vi.fn(),
}))

vi.mock("./prisma", () => ({
  prisma: {
    registrationPlan: { findFirst: mocks.planFindFirst },
    athlete: { count: mocks.athleteCount },
    event: { findFirst: vi.fn() },
    eventModality: { findFirst: vi.fn() },
    order: { findFirst: vi.fn() },
  },
}))

import {
  assertAthletesAccess,
  assertPlanAccess,
  canAccessDiscipline,
  disciplineArrayWhere,
  explicitDisciplineAccess,
  isClubCoordinator,
  orderAccessWhere,
} from "./club-access"

const coordinator = {
  id: "user-coordinator",
  clubId: "club-1",
  disciplineAccess: [],
}
const polo = {
  id: "user-polo",
  clubId: "club-1",
  disciplineAccess: ["WATER_POLO" as const],
}

describe("club discipline access", () => {
  beforeEach(() => vi.clearAllMocks())

  it("interpreta el alcance vacío como coordinador general", () => {
    expect(isClubCoordinator(coordinator)).toBe(true)
    expect(explicitDisciplineAccess(coordinator)).toBeUndefined()
    expect(canAccessDiscipline(coordinator, "ARTISTIC_SWIMMING")).toBe(true)
    expect(disciplineArrayWhere(coordinator)).toEqual({})
  })

  it("limita usuarios de sección a su disciplina", () => {
    expect(isClubCoordinator(polo)).toBe(false)
    expect(explicitDisciplineAccess(polo)).toEqual(["WATER_POLO"])
    expect(canAccessDiscipline(polo, "WATER_POLO")).toBe(true)
    expect(canAccessDiscipline(polo, "ARTISTIC_SWIMMING")).toBe(false)
    expect(disciplineArrayWhere(polo)).toEqual({
      disciplines: { hasSome: ["WATER_POLO"] },
    })
  })

  it("exige que la planilla pertenezca al evento de la sección", async () => {
    mocks.planFindFirst.mockResolvedValueOnce(null)
    await expect(assertPlanAccess(polo, "plan-artistica")).rejects.toThrow(
      "No autorizado"
    )
    expect(mocks.planFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clubId: "club-1",
          disciplineScope: { in: ["WATER_POLO"] },
        }),
      })
    )
  })

  it("rechaza deportistas fuera del padrón visible", async () => {
    mocks.athleteCount.mockResolvedValueOnce(1)
    await expect(
      assertAthletesAccess(polo, ["athlete-polo", "athlete-artistica"])
    ).rejects.toThrow("No autorizado")
  })

  it("construye un filtro de órdenes por disciplina", () => {
    expect(orderAccessWhere(polo)).toEqual({
      OR: expect.arrayContaining([
        expect.objectContaining({
          kind: "REGISTRATION",
          registrationPlan: {
            disciplineScope: { in: ["WATER_POLO"] },
          },
        }),
        expect.objectContaining({ kind: "AFFILIATION" }),
      ]),
    })
  })
})
