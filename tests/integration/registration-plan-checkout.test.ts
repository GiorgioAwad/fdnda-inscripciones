import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/prisma"
import {
  checkoutRegistrationPlan,
  createOrResumeRegistrationPlan,
  replaceRegistrationPlanRoster,
  saveRegistrationPlanEntry,
  selectRegistrationPlanEvent,
} from "@/lib/registration-plans"
import { expireStaleOrders, fulfillPaidOrder } from "@/lib/orders"
import { registrationOrderItemView } from "@/lib/registration-snapshots"
import { getClubEventReport, getEventReport } from "@/lib/event-report"

type PreparedPlan = {
  planId: string
  clubId: string
  userId: string
  athleteId: string
  revision: number
}

let eventId = ""
let modalityId = ""
const plans: PreparedPlan[] = []

async function preparePlan(input: {
  clubId: string
  userId: string
  athleteId: string
}): Promise<PreparedPlan> {
  const created = await createOrResumeRegistrationPlan({
    clubId: input.clubId,
    createdById: input.userId,
    athleteIds: [input.athleteId],
  })
  expect(created.success).toBe(true)
  if (!created.success) throw new Error(created.error)

  const selected = await selectRegistrationPlanEvent({
    planId: created.planId,
    clubId: input.clubId,
    eventId,
    expectedRevision: created.revision,
  })
  expect(selected.success).toBe(true)
  if (!selected.success) throw new Error(selected.error)

  const entry = await saveRegistrationPlanEntry({
    planId: selected.planId,
    clubId: input.clubId,
    expectedRevision: selected.revision,
    entry: { modalityId, athleteIds: [input.athleteId] },
  })
  expect(entry.success).toBe(true)
  if (!entry.success) throw new Error(entry.error)

  return {
    ...input,
    planId: entry.planId,
    revision: entry.revision,
  }
}

beforeAll(async () => {
  await prisma.season.updateMany({
    where: { isCurrent: true },
    data: { isCurrent: false },
  })
  const season = await prisma.season.create({
    data: {
      year: 2030,
      name: "Temporada 2030",
      startDate: new Date("2030-01-01T00:00:00.000Z"),
      endDate: new Date("2030-12-31T00:00:00.000Z"),
      isCurrent: true,
    },
  })
  await prisma.seasonFee.create({
    data: {
      seasonId: season.id,
      discipline: "DIVING",
      clubFee: 100,
      athleteFee: 20,
    },
  })

  const event = await prisma.event.create({
    data: {
      seasonId: season.id,
      name: "Copa de concurrencia",
      slug: "copa-concurrencia",
      disciplines: ["DIVING"],
      startDate: new Date("2030-06-10T00:00:00.000Z"),
      endDate: new Date("2030-06-12T00:00:00.000Z"),
      registrationDeadline: new Date("2030-06-01T23:59:00.000Z"),
      status: "OPEN",
    },
  })
  eventId = event.id
  const modality = await prisma.eventModality.create({
    data: {
      eventId,
      discipline: "DIVING",
      name: "Trampolin 1 m",
      sexRule: "ANY",
      minAthletes: 1,
      maxAthletes: 1,
      price: 75.5,
      capacity: 1,
    },
  })
  modalityId = modality.id

  for (const suffix of ["uno", "dos"]) {
    const club = await prisma.club.create({
      data: { name: `Club ${suffix}`, code: `C-${suffix}` },
    })
    const user = await prisma.user.create({
      data: {
        username: `delegado-${suffix}`,
        name: `Delegado ${suffix}`,
        passwordHash: "integration-test-only",
        role: "CLUB",
        clubId: club.id,
      },
    })
    const athlete = await prisma.athlete.create({
      data: {
        firstNames: `Atleta ${suffix}`,
        lastNames: "Prueba",
        docNumber: `DOC-${suffix}`,
        birthDate: new Date("2012-04-02T00:00:00.000Z"),
        sex: suffix === "uno" ? "F" : "M",
        clubId: club.id,
        disciplines: ["DIVING"],
      },
    })
    await prisma.clubAffiliation.create({
      data: {
        clubId: club.id,
        seasonId: season.id,
        discipline: "DIVING",
        status: "ACTIVE",
        fee: 100,
        validFrom: season.startDate,
        validTo: season.endDate,
      },
    })
    await prisma.athleteAffiliation.create({
      data: {
        athleteId: athlete.id,
        clubId: club.id,
        seasonId: season.id,
        discipline: "DIVING",
        status: "ACTIVE",
        fee: 20,
        validFrom: season.startDate,
        validTo: season.endDate,
      },
    })
    plans.push(
      await preparePlan({ clubId: club.id, userId: user.id, athleteId: athlete.id })
    )
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe("checkout transaccional de planillas", () => {
  it("rechaza propiedad ajena y una revisión obsoleta sin mutar la planilla", async () => {
    const owned = plans[0]
    const otherClub = plans[1]

    const foreign = await replaceRegistrationPlanRoster({
      planId: owned.planId,
      clubId: otherClub.clubId,
      expectedRevision: owned.revision,
      athleteIds: [otherClub.athleteId],
    })
    expect(foreign).toMatchObject({ success: false, code: "NOT_FOUND" })

    const stale = await replaceRegistrationPlanRoster({
      planId: owned.planId,
      clubId: owned.clubId,
      expectedRevision: owned.revision - 1,
      athleteIds: [owned.athleteId],
    })
    expect(stale).toMatchObject({
      success: false,
      code: "REVISION_CONFLICT",
      currentRevision: owned.revision,
    })
    expect(
      await prisma.registrationPlan.findUniqueOrThrow({
        where: { id: owned.planId },
        select: { revision: true },
      })
    ).toEqual({ revision: owned.revision })
  })

  it("fusiona la nómina sin evento con la planilla activa de la competencia", async () => {
    const target = plans[0]
    const source = await createOrResumeRegistrationPlan({
      clubId: target.clubId,
      createdById: target.userId,
      athleteIds: [target.athleteId],
    })
    expect(source.success).toBe(true)
    if (!source.success) throw new Error(source.error)
    expect(source.planId).not.toBe(target.planId)

    const merged = await selectRegistrationPlanEvent({
      planId: source.planId,
      clubId: target.clubId,
      eventId,
      expectedRevision: source.revision,
    })
    expect(merged).toMatchObject({
      success: true,
      planId: target.planId,
      merged: true,
    })
    if (!merged.success) throw new Error(merged.error)
    target.revision = merged.revision
    expect(
      await prisma.registrationPlan.findUniqueOrThrow({
        where: { id: source.planId },
        select: { status: true },
      })
    ).toEqual({ status: "ABANDONED" })
  })

  it("otorga el ultimo cupo una sola vez, es idempotente y libera al expirar", async () => {
    const results = await Promise.all(
      plans.map((plan) =>
        checkoutRegistrationPlan({
          planId: plan.planId,
          clubId: plan.clubId,
          userId: plan.userId,
          expectedRevision: plan.revision,
        })
      )
    )

    const winners = results.filter((result) => result.success)
    const losers = results.filter((result) => !result.success)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0]).toMatchObject({ code: "VALIDATION_FAILED" })

    const winner = winners[0]
    if (!winner.success) throw new Error("No hubo ganador")
    const winnerPlan = plans[results.indexOf(winner)]

    expect(
      await prisma.order.count({
        where: { eventId, status: "PENDING", kind: "REGISTRATION" },
      })
    ).toBe(1)

    const retry = await checkoutRegistrationPlan({
      planId: winnerPlan.planId,
      clubId: winnerPlan.clubId,
      userId: winnerPlan.userId,
      expectedRevision: winnerPlan.revision,
    })
    expect(retry).toMatchObject({
      success: true,
      orderId: winner.orderId,
      reused: true,
    })

    await prisma.eventModality.update({
      where: { id: modalityId },
      data: { name: "Nombre administrativo posterior", price: 999 },
    })
    await prisma.club.update({
      where: { id: winnerPlan.clubId },
      data: { name: "Club renombrado" },
    })
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: winner.orderId },
    })
    const frozen = registrationOrderItemView(item)
    expect(frozen.snapshot?.modality.name).toBe("Trampolin 1 m")
    expect(frozen.unitPrice).toBe(75.5)
    expect(frozen.snapshot?.club.name).not.toBe("Club renombrado")

    await prisma.order.update({
      where: { id: winner.orderId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    expect(await expireStaleOrders()).toBe(1)
    expect(
      await prisma.registrationPlan.findUniqueOrThrow({
        where: { id: winnerPlan.planId },
        select: { status: true },
      })
    ).toEqual({ status: "DRAFT" })
    expect(
      await prisma.registration.findFirstOrThrow({
        where: { planId: winnerPlan.planId },
        select: { status: true, activeOrderId: true },
      })
    ).toEqual({ status: "IN_CART", activeOrderId: null })

    // A real double click starts both requests with the exact same revision.
    // The plan lock + serializable retry must return one shared order, never two.
    const releasedPlan = await prisma.registrationPlan.findUniqueOrThrow({
      where: { id: winnerPlan.planId },
      select: { revision: true },
    })
    const doubleClick = await Promise.all([
      checkoutRegistrationPlan({
        planId: winnerPlan.planId,
        clubId: winnerPlan.clubId,
        userId: winnerPlan.userId,
        expectedRevision: releasedPlan.revision,
      }),
      checkoutRegistrationPlan({
        planId: winnerPlan.planId,
        clubId: winnerPlan.clubId,
        userId: winnerPlan.userId,
        expectedRevision: releasedPlan.revision,
      }),
    ])
    expect(doubleClick.every((result) => result.success)).toBe(true)
    const doubleClickOrderIds = new Set(
      doubleClick.flatMap((result) => (result.success ? [result.orderId] : []))
    )
    expect(doubleClickOrderIds.size).toBe(1)
    const doubleClickOrderId = [...doubleClickOrderIds][0]
    expect(
      await prisma.order.count({
        where: {
          registrationPlanId: winnerPlan.planId,
          status: "PENDING",
        },
      })
    ).toBe(1)

    await prisma.order.update({
      where: { id: doubleClickOrderId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    expect(await expireStaleOrders()).toBe(1)

    const loserIndex = results.findIndex((result) => !result.success)
    const nextPlan = plans[loserIndex]
    const nextCheckout = await checkoutRegistrationPlan({
      planId: nextPlan.planId,
      clubId: nextPlan.clubId,
      userId: nextPlan.userId,
      expectedRevision: nextPlan.revision,
    })
    expect(nextCheckout.success).toBe(true)
    if (!nextCheckout.success) throw new Error(nextCheckout.error)

    expect(
      await fulfillPaidOrder({
        orderId: nextCheckout.orderId,
        provider: "TEST",
        providerRef: "integration",
      })
    ).toEqual({ success: true })
    const paidPlan = await prisma.registrationPlan.findUniqueOrThrow({
      where: { id: nextPlan.planId },
      select: { status: true, revision: true },
    })
    expect(paidPlan.status).toBe("PAID")

    await prisma.event.update({
      where: { id: eventId },
      data: { name: "Nombre vivo posterior al pago" },
    })
    const frozenReport = await getEventReport(eventId)
    expect(frozenReport?.event.name).toBe("Copa de concurrencia")

    const immutable = await replaceRegistrationPlanRoster({
      planId: nextPlan.planId,
      clubId: nextPlan.clubId,
      expectedRevision: paidPlan.revision,
      athleteIds: [],
    })
    expect(immutable).toMatchObject({ success: false, code: "PLAN_NOT_EDITABLE" })
  })

  it("el reporte descargable de un club no filtra datos de otros clubes", async () => {
    // El test anterior dejó una inscripción pagada del club perdedor original.
    const withEntries = await prisma.registration.findFirstOrThrow({
      where: { modality: { eventId }, status: { in: ["PAID", "PENDING_PAYMENT"] } },
      select: { clubId: true },
    })
    const otherClubId = plans.find((plan) => plan.clubId !== withEntries.clubId)!
      .clubId

    const own = await getClubEventReport(eventId, withEntries.clubId)
    const foreign = await getClubEventReport(eventId, otherClubId)

    expect(own).not.toBeNull()
    expect(own!.nominalRows.length).toBeGreaterThan(0)
    // El club sin inscripciones vivas ve su propio reporte vacío, no el ajeno.
    expect(foreign!.nominalRows).toHaveLength(0)
    expect(foreign!.totals.amount).toBe(0)

    // Y lo que ve cada uno es solo suyo.
    const federationReport = await getEventReport(eventId)
    expect(own!.totals.amount).toBeLessThanOrEqual(
      federationReport!.totals.revenue
    )
  })
})
