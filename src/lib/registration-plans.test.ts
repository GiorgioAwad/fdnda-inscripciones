import { beforeEach, describe, expect, it, vi } from "vitest"

const database = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
  tx: {
    $queryRaw: vi.fn(),
    user: { findFirst: vi.fn() },
    athlete: { count: vi.fn() },
    registrationPlan: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    registrationPlanAthlete: {
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
    },
    eventModality: { findFirst: vi.fn() },
    registration: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    registrationAthlete: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("./prisma", () => ({ prisma: database.prisma }))

import {
  createOrResumeRegistrationPlan,
  isRetryableRegistrationPlanTransactionError,
  saveRegistrationPlanEntry,
  setRegistrationPlanAthleteSelection,
} from "./registration-plans"

describe("deteccion de conflictos transaccionales reintentables", () => {
  it.each([
    { code: "P2034" },
    { cause: { originalCode: "40001" } },
    {
      meta: {
        driverAdapterError: { cause: { originalCode: "40001" } },
      },
    },
    { meta: { driverAdapterError: { cause: { code: "40P01" } } } },
  ])("reconoce el envoltorio %# como reintentable", (error) => {
    expect(isRetryableRegistrationPlanTransactionError(error)).toBe(true)
  })

  it("rechaza codigos no reintentables y tolera referencias ciclicas", () => {
    const cyclic: { cause?: unknown } = {}
    cyclic.cause = cyclic

    expect(isRetryableRegistrationPlanTransactionError({ code: "P2002" })).toBe(
      false
    )
    expect(isRetryableRegistrationPlanTransactionError(cyclic)).toBe(false)
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  database.prisma.$transaction.mockImplementation(
    async (work: (tx: typeof database.tx) => Promise<unknown>) =>
      work(database.tx)
  )
  database.tx.$queryRaw.mockResolvedValue([])
  database.tx.user.findFirst.mockResolvedValue({ id: "user-1" })
  database.tx.athlete.count.mockResolvedValue(2)
  database.tx.registrationPlanAthlete.createMany.mockResolvedValue({ count: 2 })
})

describe("crear o reanudar una planilla", () => {
  it("normaliza la nómina y limita el paso al rango 1..4", async () => {
    database.tx.registrationPlan.findFirst.mockResolvedValue(null)
    database.tx.registrationPlan.create.mockImplementation(
      async ({ data }: { data: { currentStep: number } }) => ({
        id: "plan-1",
        status: "DRAFT",
        revision: 0,
        currentStep: data.currentStep,
        eventId: null,
      })
    )

    const result = await createOrResumeRegistrationPlan({
      clubId: "club-1",
      createdById: "user-1",
      athleteIds: [" athlete-1 ", "athlete-1", "", "athlete-2"],
      currentStep: 99,
    })

    expect(result).toMatchObject({
      success: true,
      planId: "plan-1",
      currentStep: 4,
      resumed: false,
    })
    expect(database.tx.athlete.count).toHaveBeenCalledWith({
      where: {
        id: { in: ["athlete-1", "athlete-2"] },
        clubId: "club-1",
        isActive: true,
      },
    })
    expect(database.tx.registrationPlanAthlete.createMany).toHaveBeenCalledWith({
      data: [
        { planId: "plan-1", athleteId: "athlete-1" },
        { planId: "plan-1", athleteId: "athlete-2" },
      ],
    })
  })

  it("reanuda el único borrador sin volver a crear nómina", async () => {
    database.tx.registrationPlan.findFirst.mockResolvedValue({
      id: "plan-existing",
      status: "DRAFT",
      revision: 3,
      currentStep: 2,
      eventId: null,
    })

    const result = await createOrResumeRegistrationPlan({
      clubId: "club-1",
      createdById: "user-1",
      athleteIds: ["athlete-1"],
    })

    expect(result).toMatchObject({
      success: true,
      planId: "plan-existing",
      resumed: true,
    })
    expect(database.tx.registrationPlan.create).not.toHaveBeenCalled()
    expect(database.tx.registrationPlanAthlete.createMany).not.toHaveBeenCalled()
  })

  it("rechaza una nómina mayor al límite antes de abrir transacción", async () => {
    const athleteIds = Array.from({ length: 2_001 }, (_, index) => `a-${index}`)

    const result = await createOrResumeRegistrationPlan({
      clubId: "club-1",
      createdById: "user-1",
      athleteIds,
    })

    expect(result).toMatchObject({
      success: false,
      code: "INVALID_ATHLETES",
    })
    expect(database.prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("guardar formaciones y reservas", () => {
  function editablePlan() {
    database.tx.registrationPlan.findFirst.mockResolvedValue({
      id: "plan-1",
      clubId: "club-1",
      eventId: "event-1",
      status: "DRAFT",
      revision: 4,
      currentStep: 2,
    })
    database.tx.eventModality.findFirst.mockResolvedValue({ id: "modality-1" })
    database.tx.registrationPlanAthlete.count.mockResolvedValue(2)
    database.tx.registration.count.mockResolvedValue(0)
    database.tx.registrationAthlete.findFirst.mockResolvedValue(null)
    database.tx.registration.create.mockResolvedValue({ id: "entry-created" })
    database.tx.registrationAthlete.createMany.mockResolvedValue({ count: 2 })
    database.tx.registrationPlan.update.mockResolvedValue({
      id: "plan-1",
      status: "DRAFT",
      revision: 5,
      currentStep: 3,
      eventId: "event-1",
    })
  }

  it("deduplica integrantes y solo marca reservas que pertenecen a la formación", async () => {
    editablePlan()

    const result = await saveRegistrationPlanEntry({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 4,
      entry: {
        modalityId: "modality-1",
        athleteIds: [" athlete-1 ", "athlete-2", "athlete-2"],
        reserveIds: ["athlete-2", "fuera-de-formacion"],
      },
    })

    expect(result).toMatchObject({
      success: true,
      planId: "plan-1",
      revision: 5,
      currentStep: 3,
    })
    const createdRegistration = database.tx.registration.create.mock.calls[0][0]
    const registrationId = createdRegistration.data.id as string
    expect(database.tx.registrationAthlete.createMany).toHaveBeenCalledWith({
      data: [
        {
          registrationId,
          modalityId: "modality-1",
          athleteId: "athlete-1",
          isReserve: false,
        },
        {
          registrationId,
          modalityId: "modality-1",
          athleteId: "athlete-2",
          isReserve: true,
        },
      ],
    })
  })

  it("bloquea un deportista duplicado en otra formación de la misma prueba", async () => {
    editablePlan()
    database.tx.registrationAthlete.findFirst.mockResolvedValue({
      athlete: { firstNames: "Ana", lastNames: "Duplicada" },
    })

    const result = await saveRegistrationPlanEntry({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 4,
      entry: {
        modalityId: "modality-1",
        athleteIds: ["athlete-1", "athlete-2"],
      },
    })

    expect(result).toMatchObject({
      success: false,
      code: "DUPLICATE_ENTRY",
      error: "Ana Duplicada ya aparece en esta prueba.",
    })
    expect(database.tx.registration.create).not.toHaveBeenCalled()
    expect(database.tx.registrationAthlete.createMany).not.toHaveBeenCalled()
  })

  it("persiste una formación incompleta para corregirla después", async () => {
    editablePlan()

    const result = await saveRegistrationPlanEntry({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 4,
      entry: {
        modalityId: "modality-1",
        athleteIds: [],
        reserveIds: [],
      },
    })

    expect(result).toMatchObject({ success: true, revision: 5 })
    expect(database.tx.registration.create).toHaveBeenCalledOnce()
    expect(database.tx.registrationAthlete.createMany).not.toHaveBeenCalled()
  })
})

describe("autoguardado incremental de la nómina", () => {
  function editableRosterPlan() {
    database.tx.registrationPlan.findFirst.mockResolvedValue({
      id: "plan-1",
      clubId: "club-1",
      eventId: null,
      status: "DRAFT",
      revision: 2,
      currentStep: 1,
    })
    database.tx.registrationPlan.update.mockResolvedValue({
      id: "plan-1",
      status: "DRAFT",
      revision: 3,
      currentStep: 1,
      eventId: null,
    })
  }

  it("agrega solo el deportista seleccionado", async () => {
    editableRosterPlan()
    database.tx.registrationPlanAthlete.findUnique.mockResolvedValue(null)
    database.tx.registrationPlanAthlete.count.mockResolvedValue(12)
    database.tx.athlete.count.mockResolvedValue(1)

    const result = await setRegistrationPlanAthleteSelection({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 2,
      athleteId: "athlete-1",
      selected: true,
    })

    expect(result).toMatchObject({ success: true, revision: 3 })
    expect(database.tx.registrationPlanAthlete.create).toHaveBeenCalledWith({
      data: { planId: "plan-1", athleteId: "athlete-1" },
    })
    expect(database.tx.registrationPlanAthlete.createMany).not.toHaveBeenCalled()
    expect(database.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "ReadCommitted" })
    )
  })

  it("retira al deportista y conserva la formación de equipo incompleta", async () => {
    editableRosterPlan()
    database.tx.registrationPlanAthlete.findUnique.mockResolvedValue({ id: "roster-1" })
    database.tx.registrationAthlete.findMany.mockResolvedValue([
      { registrationId: "entry-1" },
    ])

    const result = await setRegistrationPlanAthleteSelection({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 2,
      athleteId: "athlete-1",
      selected: false,
    })

    expect(result).toMatchObject({ success: true, revision: 3 })
    expect(database.tx.registrationAthlete.deleteMany).toHaveBeenCalledWith({
      where: {
        athleteId: "athlete-1",
        registration: { planId: "plan-1", status: "IN_CART" },
      },
    })
    // Solo se borran las formaciones que quedaron vacías POR esta remoción; la
    // condición athletes.none garantiza que un dueto al que le queda una
    // integrante sobreviva como borrador.
    expect(database.tx.registration.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["entry-1"] },
        planId: "plan-1",
        status: "IN_CART",
        athletes: { none: {} },
      },
    })
    expect(database.tx.registrationPlanAthlete.delete).toHaveBeenCalledWith({
      where: { id: "roster-1" },
    })
  })

  it("no toca otras formaciones si el deportista no estaba en ninguna", async () => {
    editableRosterPlan()
    database.tx.registrationPlanAthlete.findUnique.mockResolvedValue({ id: "roster-1" })
    database.tx.registrationAthlete.findMany.mockResolvedValue([])

    const result = await setRegistrationPlanAthleteSelection({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 2,
      athleteId: "athlete-1",
      selected: false,
    })

    expect(result).toMatchObject({ success: true })
    expect(database.tx.registration.deleteMany).not.toHaveBeenCalled()
  })
})
