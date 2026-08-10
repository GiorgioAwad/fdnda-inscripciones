import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { afterAll, describe, expect, it } from "vitest"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL es obligatorio.")

const scenario = process.env.BACKFILL_TEST_SCENARIO
if (scenario !== "empty" && scenario !== "historical") {
  throw new Error("BACKFILL_TEST_SCENARIO debe ser empty o historical.")
}

const pool = new Pool({ connectionString: databaseUrl })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function runBackfill() {
  const result = spawnSync(
    process.execPath,
    [
      resolve("node_modules/tsx/dist/cli.mjs"),
      "scripts/backfill-registration-plans.ts",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test" },
      encoding: "utf8",
    }
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      [result.stdout, result.stderr, `Backfill termino con codigo ${result.status}.`]
        .filter(Boolean)
        .join("\n")
    )
  }
  return result.stdout
}

async function orderBusinessSnapshot(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { orderBy: { id: "asc" } } },
  })
  return {
    id: order.id,
    code: order.code,
    clubId: order.clubId,
    userId: order.userId,
    kind: order.kind,
    totalAmount: order.totalAmount.toFixed(2),
    currency: order.currency,
    status: order.status,
    provider: order.provider,
    providerOrderNumber: order.providerOrderNumber,
    providerTransactionId: order.providerTransactionId,
    providerRef: order.providerRef,
    providerResponse: order.providerResponse,
    paidAt: order.paidAt?.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      registrationId: item.registrationId,
      clubAffiliationId: item.clubAffiliationId,
      athleteAffiliationId: item.athleteAffiliationId,
      description: item.description,
      unitPrice: item.unitPrice.toFixed(2),
      registrationSnapshot: item.registrationSnapshot,
    })),
  }
}

afterAll(async () => {
  await prisma.$disconnect()
  await pool.end()
})

describe.skipIf(scenario !== "empty")(
  "migracion y backfill desde una base vacia",
  () => {
    it("aplica todo el esquema y permite ejecutar el backfill dos veces sin crear datos", async () => {
      const migrations = await prisma.$queryRaw<
        Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
      >`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY migration_name
      `
      expect(migrations.some((item) => item.migration_name === "20260803230000_registration_plans")).toBe(true)
      expect(migrations.every((item) => item.finished_at && !item.rolled_back_at)).toBe(true)

      const [constraint] = await prisma.$queryRaw<
        Array<{ convalidated: boolean }>
      >`
        SELECT convalidated
        FROM pg_constraint
        WHERE conname = 'event_modalities_category_upgrade_artistic_check'
      `
      expect(constraint).toEqual({ convalidated: false })

      expect(runBackfill()).toContain("Backfill completado")
      expect(runBackfill()).toContain("Backfill completado")

      const [validated] = await prisma.$queryRaw<
        Array<{ convalidated: boolean }>
      >`
        SELECT convalidated
        FROM pg_constraint
        WHERE conname = 'event_modalities_category_upgrade_artistic_check'
      `
      expect(validated).toEqual({ convalidated: true })
      expect(await prisma.registrationPlan.count()).toBe(0)
      expect(await prisma.registrationPlanAthlete.count()).toBe(0)
      expect(await prisma.order.count()).toBe(0)
      expect(await prisma.registration.count()).toBe(0)
    })
  }
)

describe.skipIf(scenario !== "historical")(
  "migracion y backfill de ordenes historicas",
  () => {
    it("migra la orden pagada de un evento y conserva intacta la orden multievento", async () => {
      const singleBefore = await orderBusinessSnapshot("legacy-order-single")
      const mixedBefore = await orderBusinessSnapshot("legacy-order-mixed")
      const pendingABefore = await orderBusinessSnapshot("legacy-order-pending-a")
      const pendingBBefore = await orderBusinessSnapshot("legacy-order-pending-b")

      expect(singleBefore).toMatchObject({
        totalAmount: "123.45",
        status: "PAID",
        provider: "IZIPAY",
        providerOrderNumber: "981234567",
        providerTransactionId: "TX-REG-001",
        providerRef: "REF-SINGLE-001",
      })
      expect(mixedBefore).toMatchObject({
        totalAmount: "200.00",
        status: "PAID",
        providerOrderNumber: "981234568",
        providerTransactionId: "TX-REG-002",
      })

      const firstOutput = runBackfill()
      expect(firstOutput).toContain("orden histórica mixta")

      const singleOrder = await prisma.order.findUniqueOrThrow({
        where: { id: "legacy-order-single" },
        select: { registrationPlanId: true, eventId: true },
      })
      expect(singleOrder.eventId).toBe("legacy-event-one")
      expect(singleOrder.registrationPlanId).toBeTruthy()

      const plan = await prisma.registrationPlan.findUniqueOrThrow({
        where: { id: singleOrder.registrationPlanId! },
        include: {
          athletes: { orderBy: { athleteId: "asc" } },
          registrations: { orderBy: { id: "asc" } },
        },
      })
      expect(plan).toMatchObject({
        clubId: "legacy-club",
        eventId: "legacy-event-one",
        createdById: "legacy-user",
        status: "PAID",
        currentStep: 4,
      })
      expect(plan.createdAt.toISOString()).toBe("2026-05-01T10:00:00.000Z")
      expect(plan.athletes.map((item) => item.athleteId)).toEqual([
        "legacy-athlete-single",
      ])
      expect(plan.registrations.map((item) => item.id)).toEqual([
        "legacy-registration-single",
      ])

      expect(
        await prisma.order.findUniqueOrThrow({
          where: { id: "legacy-order-mixed" },
          select: { registrationPlanId: true, eventId: true, isLegacy: true },
        })
      ).toEqual({ registrationPlanId: null, eventId: null, isLegacy: true })
      expect(
        await prisma.registration.findMany({
          where: { id: { in: ["legacy-registration-mixed-a", "legacy-registration-mixed-b"] } },
          select: { id: true, planId: true },
          orderBy: { id: "asc" },
        })
      ).toEqual([
        { id: "legacy-registration-mixed-a", planId: null },
        { id: "legacy-registration-mixed-b", planId: null },
      ])

      expect(await orderBusinessSnapshot("legacy-order-single")).toEqual(singleBefore)
      expect(await orderBusinessSnapshot("legacy-order-mixed")).toEqual(mixedBefore)

      const pendingOrders = await prisma.order.findMany({
        where: {
          id: { in: ["legacy-order-pending-a", "legacy-order-pending-b"] },
        },
        select: { id: true, registrationPlanId: true, eventId: true },
        orderBy: { id: "asc" },
      })
      expect(pendingOrders[0]).toMatchObject({
        id: "legacy-order-pending-a",
        eventId: "legacy-event-one",
      })
      expect(pendingOrders[0].registrationPlanId).toBeTruthy()
      expect(pendingOrders[1]).toEqual({
        id: "legacy-order-pending-b",
        registrationPlanId: null,
        eventId: null,
      })

      const pendingPlan = await prisma.registrationPlan.findUniqueOrThrow({
        where: { id: pendingOrders[0].registrationPlanId! },
        include: {
          registrations: { orderBy: { id: "asc" } },
          athletes: { orderBy: { athleteId: "asc" } },
        },
      })
      expect(pendingPlan.status).toBe("AWAITING_PAYMENT")
      expect(pendingPlan.registrations.map((item) => item.id)).toEqual([
        "legacy-registration-pending-a",
      ])
      expect(pendingPlan.athletes.map((item) => item.athleteId)).toEqual([
        "legacy-athlete-pending-a",
      ])
      expect(
        await prisma.registration.findMany({
          where: {
            id: {
              in: ["legacy-registration-pending-b", "legacy-registration-cart"],
            },
          },
          select: { id: true, planId: true, status: true },
          orderBy: { id: "asc" },
        })
      ).toEqual([
        { id: "legacy-registration-cart", planId: null, status: "IN_CART" },
        {
          id: "legacy-registration-pending-b",
          planId: null,
          status: "PENDING_PAYMENT",
        },
      ])
      expect(firstOutput).toContain("queda como legado sin vincular")
      expect(firstOutput).toContain("permanecen sin plan y no se anexaron")
      expect(await orderBusinessSnapshot("legacy-order-pending-a")).toEqual(
        pendingABefore
      )
      expect(await orderBusinessSnapshot("legacy-order-pending-b")).toEqual(
        pendingBBefore
      )
      expect(
        await prisma.event.findMany({
          select: { id: true, seasonId: true },
          orderBy: { id: "asc" },
        })
      ).toEqual([
        { id: "legacy-event-one", seasonId: "legacy-season" },
        { id: "legacy-event-two", seasonId: "legacy-season" },
      ])

      const stateAfterFirstRun = {
        plans: await prisma.registrationPlan.findMany({
          include: { athletes: true },
          orderBy: { id: "asc" },
        }),
        registrations: await prisma.registration.findMany({
          select: { id: true, planId: true, status: true, activeOrderId: true },
          orderBy: { id: "asc" },
        }),
        orders: await prisma.order.findMany({
          select: {
            id: true,
            registrationPlanId: true,
            eventId: true,
            totalAmount: true,
            status: true,
            providerOrderNumber: true,
            providerTransactionId: true,
            providerRef: true,
            isLegacy: true,
            updatedAt: true,
          },
          orderBy: { id: "asc" },
        }),
      }

      const secondOutput = runBackfill()
      expect(secondOutput).toContain("planes creados: 0")
      expect(secondOutput).toContain("órdenes actualizadas: 0")

      expect({
        plans: await prisma.registrationPlan.findMany({
          include: { athletes: true },
          orderBy: { id: "asc" },
        }),
        registrations: await prisma.registration.findMany({
          select: { id: true, planId: true, status: true, activeOrderId: true },
          orderBy: { id: "asc" },
        }),
        orders: await prisma.order.findMany({
          select: {
            id: true,
            registrationPlanId: true,
            eventId: true,
            totalAmount: true,
            status: true,
            providerOrderNumber: true,
            providerTransactionId: true,
            providerRef: true,
            isLegacy: true,
            updatedAt: true,
          },
          orderBy: { id: "asc" },
        }),
      }).toEqual(stateAfterFirstRun)

      expect(await prisma.registrationPlan.count()).toBe(2)
      expect(await prisma.registrationPlanAthlete.count()).toBe(2)
      expect(await orderBusinessSnapshot("legacy-order-single")).toEqual(singleBefore)
      expect(await orderBusinessSnapshot("legacy-order-mixed")).toEqual(mixedBefore)
      expect(await orderBusinessSnapshot("legacy-order-pending-a")).toEqual(
        pendingABefore
      )
      expect(await orderBusinessSnapshot("legacy-order-pending-b")).toEqual(
        pendingBBefore
      )
    })
  }
)
