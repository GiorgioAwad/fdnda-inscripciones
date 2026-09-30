import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/prisma"
import {
  checkoutRegistrationPlan,
  createOrResumeRegistrationPlan,
  saveRegistrationPlanEntry,
  selectRegistrationPlanEvent,
} from "@/lib/registration-plans"
import { expireStaleOrders, failOrder, fulfillPaidOrder } from "@/lib/orders"
import { getEventReport } from "@/lib/event-report"

// Clavados cobra un monto fijo por deportista para TODO el evento. Estos casos
// cubren lo que no puede fallar: que varias pruebas del mismo deportista se
// cobren una sola vez, que una planilla suplementaria no vuelva a cobrar, y que
// un intento de pago fallido no deje la cuota bloqueada.

const ATHLETE_FEE = 80
const MODALITY_PRICE = 60

let eventId = ""
let clubId = ""
let userId = ""
let athleteId = ""
let secondAthleteId = ""
const modalityIds: string[] = []

beforeAll(async () => {
  await prisma.season.updateMany({
    where: { isCurrent: true },
    data: { isCurrent: false },
  })
  const season = await prisma.season.create({
    data: {
      year: 2031,
      name: "Temporada 2031",
      startDate: new Date("2031-01-01T00:00:00.000Z"),
      endDate: new Date("2031-12-31T00:00:00.000Z"),
      isCurrent: true,
    },
  })
  await prisma.seasonFee.create({
    data: { seasonId: season.id, discipline: "DIVING", clubFee: 100, athleteFee: 20 },
  })

  const event = await prisma.event.create({
    data: {
      seasonId: season.id,
      name: "Nacional de Clavados",
      slug: "nacional-clavados-2031",
      disciplines: ["DIVING"],
      startDate: new Date("2031-06-10T00:00:00.000Z"),
      endDate: new Date("2031-06-12T00:00:00.000Z"),
      registrationDeadline: new Date("2031-06-01T23:59:00.000Z"),
      status: "OPEN",
      disciplineConfigs: {
        create: [
          {
            discipline: "DIVING",
            pricingMode: "PER_ATHLETE",
            chargesEntry: false,
            chargesAthleteFee: true,
            athleteFee: ATHLETE_FEE,
            ageRuleMode: "RANGE",
          },
        ],
      },
    },
  })
  eventId = event.id

  for (const name of ["Trampolín 1m", "Trampolín 3m", "Plataforma", "Extra"]) {
    const modality = await prisma.eventModality.create({
      data: {
        eventId,
        discipline: "DIVING",
        name,
        sexRule: "ANY",
        minAthletes: 1,
        maxAthletes: 1,
        // Precio de lista: NO debe cobrarse, el cobro va en la cuota.
        price: MODALITY_PRICE,
      },
    })
    modalityIds.push(modality.id)
  }

  const club = await prisma.club.create({
    data: { name: "Club Clavados", code: "CLV" },
  })
  clubId = club.id
  const user = await prisma.user.create({
    data: {
      username: "delegado-clavados",
      name: "Delegado Clavados",
      passwordHash: "integration-test-only",
      role: "CLUB",
      clubId,
    },
  })
  userId = user.id

  await prisma.clubAffiliation.create({
    data: {
      clubId,
      seasonId: season.id,
      discipline: "DIVING",
      status: "ACTIVE",
      fee: 100,
      validFrom: season.startDate,
      validTo: season.endDate,
    },
  })

  for (const [index, names] of [
    ["Ana", "Pérez"],
    ["Luz", "Silva"],
  ].entries()) {
    const athlete = await prisma.athlete.create({
      data: {
        firstNames: names[0],
        lastNames: names[1],
        docNumber: `CLV-${index}`,
        birthDate: new Date("2012-04-02T00:00:00.000Z"),
        sex: "F",
        clubId,
        disciplines: ["DIVING"],
      },
    })
    await prisma.athleteAffiliation.create({
      data: {
        athleteId: athlete.id,
        clubId,
        seasonId: season.id,
        discipline: "DIVING",
        status: "ACTIVE",
        fee: 20,
        validFrom: season.startDate,
        validTo: season.endDate,
      },
    })
    if (index === 0) athleteId = athlete.id
    else secondAthleteId = athlete.id
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function buildPlan(entries: Array<{ modalityId: string; athleteIds: string[] }>) {
  const athleteIds = [...new Set(entries.flatMap((entry) => entry.athleteIds))]
  const created = await createOrResumeRegistrationPlan({
    clubId,
    createdById: userId,
    athleteIds,
  })
  if (!created.success) throw new Error(created.error)

  const selected = await selectRegistrationPlanEvent({
    planId: created.planId,
    clubId,
    eventId,
    expectedRevision: created.revision,
  })
  if (!selected.success) throw new Error(selected.error)

  let revision = selected.revision
  for (const entry of entries) {
    const saved = await saveRegistrationPlanEntry({
      planId: selected.planId,
      clubId,
      expectedRevision: revision,
      entry,
    })
    if (!saved.success) throw new Error(saved.error)
    revision = saved.revision
  }

  return { planId: selected.planId, revision }
}

describe("cobro fijo por deportista en clavados", () => {
  it("cobra una sola cuota aunque el deportista haga tres pruebas", async () => {
    const plan = await buildPlan([
      { modalityId: modalityIds[0], athleteIds: [athleteId] },
      { modalityId: modalityIds[1], athleteIds: [athleteId] },
      { modalityId: modalityIds[2], athleteIds: [athleteId] },
    ])

    const checkout = await checkoutRegistrationPlan({
      planId: plan.planId,
      clubId,
      userId,
      expectedRevision: plan.revision,
    })
    expect(checkout.success).toBe(true)
    if (!checkout.success) throw new Error(checkout.error)

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: checkout.orderId },
      include: { items: true },
    })

    expect(Number(order.totalAmount)).toBe(ATHLETE_FEE)
    // Las tres formaciones se conservan como registro nominal, pero a 0.
    const entryItems = order.items.filter((item) => item.registrationId !== null)
    expect(entryItems).toHaveLength(3)
    expect(entryItems.every((item) => Number(item.unitPrice) === 0)).toBe(true)
    // Y una sola línea de cuota.
    const feeItems = order.items.filter((item) => item.eventAthleteFeeId !== null)
    expect(feeItems).toHaveLength(1)
    expect(Number(feeItems[0].unitPrice)).toBe(ATHLETE_FEE)

    await fulfillPaidOrder({ orderId: order.id, provider: "test" })
    const fee = await prisma.eventAthleteFee.findUniqueOrThrow({
      where: {
        eventId_discipline_athleteId: { eventId, discipline: "DIVING", athleteId },
      },
    })
    expect(fee.status).toBe("PAID")
  })

  it("una planilla suplementaria del mismo deportista no vuelve a cobrar", async () => {
    const plan = await buildPlan([
      { modalityId: modalityIds[3], athleteIds: [athleteId] },
    ])

    const checkout = await checkoutRegistrationPlan({
      planId: plan.planId,
      clubId,
      userId,
      expectedRevision: plan.revision,
    })
    expect(checkout.success).toBe(true)
    if (!checkout.success) throw new Error(checkout.error)

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: checkout.orderId },
      include: { items: true },
    })

    expect(Number(order.totalAmount)).toBe(0)
    expect(order.items.filter((item) => item.eventAthleteFeeId !== null)).toHaveLength(0)
    // Sin pasarela que cobre S/ 0, la orden se confirma sola.
    expect(order.status).toBe("PAID")
    expect(
      await prisma.registrationPlan.findUniqueOrThrow({
        where: { id: plan.planId },
        select: { status: true },
      })
    ).toEqual({ status: "PAID" })
    // Sigue habiendo UNA sola cuota para ese deportista en el evento.
    expect(
      await prisma.eventAthleteFee.count({
        where: { eventId, discipline: "DIVING", athleteId },
      })
    ).toBe(1)
  })

  it("un pago fallido libera la cuota y el reintento la vuelve a cobrar", async () => {
    const plan = await buildPlan([
      { modalityId: modalityIds[0], athleteIds: [secondAthleteId] },
    ])

    const first = await checkoutRegistrationPlan({
      planId: plan.planId,
      clubId,
      userId,
      expectedRevision: plan.revision,
    })
    if (!first.success) throw new Error(first.error)
    expect(Number((await prisma.order.findUniqueOrThrow({
      where: { id: first.orderId },
    })).totalAmount)).toBe(ATHLETE_FEE)

    await failOrder({ orderId: first.orderId })

    // La cuota vuelve al carrito, no se queda reservada por una orden muerta.
    const released = await prisma.eventAthleteFee.findUniqueOrThrow({
      where: {
        eventId_discipline_athleteId: {
          eventId,
          discipline: "DIVING",
          athleteId: secondAthleteId,
        },
      },
    })
    expect(released).toMatchObject({ status: "IN_CART", activeOrderId: null })

    const planAfterFailure = await prisma.registrationPlan.findUniqueOrThrow({
      where: { id: plan.planId },
      select: { status: true, revision: true },
    })
    expect(planAfterFailure.status).toBe("DRAFT")

    const retry = await checkoutRegistrationPlan({
      planId: plan.planId,
      clubId,
      userId,
      expectedRevision: planAfterFailure.revision,
    })
    expect(retry.success).toBe(true)
    if (!retry.success) throw new Error(retry.error)

    const retried = await prisma.order.findUniqueOrThrow({
      where: { id: retry.orderId },
    })
    // El reintento sí cobra: la cuota nunca llegó a pagarse.
    expect(Number(retried.totalAmount)).toBe(ATHLETE_FEE)
    // Y se reutilizó la misma fila, sin duplicar el único.
    expect(
      await prisma.eventAthleteFee.count({
        where: { eventId, discipline: "DIVING", athleteId: secondAthleteId },
      })
    ).toBe(1)

    await fulfillPaidOrder({ orderId: retry.orderId, provider: "test" })
  })

  it("el reporte no duplica la recaudación con el precio de lista", async () => {
    await expireStaleOrders()
    const report = await getEventReport(eventId)
    if (!report) throw new Error("Sin reporte")

    // Dos deportistas pagaron su cuota: 2 × 80. Las pruebas no suman nada.
    expect(report.totals.athleteFeeRevenue).toBe(ATHLETE_FEE * 2)
    expect(report.totals.revenue).toBe(ATHLETE_FEE * 2)
    expect(report.athleteFeeRows).toHaveLength(2)
    expect(
      report.modalityRows.every((row) => row.revenue === 0)
    ).toBe(true)

    const clubRow = report.clubRows.find((row) => row.clubName === "Club Clavados")
    expect(clubRow?.amount).toBe(ATHLETE_FEE * 2)
  })
})
