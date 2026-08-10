import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/prisma"
import {
  countOrdersRequiringPaymentReview,
  expireStaleOrders,
  fulfillPaidOrder,
} from "@/lib/orders"
import {
  resolveIzipayPaymentContext,
  updateIzipayAttempt,
} from "@/lib/izipay-orders"
import type { ParsedIzipayPaymentResult } from "@/lib/izipay"

let clubId = ""
let userId = ""

function parsedPayment(
  overrides: Partial<ParsedIzipayPaymentResult> = {}
): ParsedIzipayPaymentResult {
  return {
    code: "00",
    payloadHttp: "signed-payload",
    signature: "signature",
    transactionId: "tx-payment-hardening",
    orderNumber: "order-payment-hardening",
    amount: 150.25,
    currency: "PEN",
    raw: {},
    payload: {},
    ...overrides,
  }
}

async function createOrder(input: {
  code: string
  expiresAt?: Date
  status?: "PENDING" | "CANCELLED"
}) {
  return prisma.order.create({
    data: {
      code: input.code,
      clubId,
      userId,
      kind: "REGISTRATION",
      totalAmount: 150.25,
      currency: "PEN",
      status: input.status ?? "PENDING",
      expiresAt: input.expiresAt ?? new Date(Date.now() + 60_000),
    },
  })
}

beforeAll(async () => {
  const club = await prisma.club.create({
    data: { name: "Club payment hardening", code: "PAY-HARD" },
  })
  clubId = club.id
  const user = await prisma.user.create({
    data: {
      username: "payment-hardening-user",
      name: "Payment Hardening User",
      passwordHash: "integration-test-only",
      role: "CLUB",
      clubId,
    },
  })
  userId = user.id
})

afterAll(async () => {
  if (!clubId) return
  await prisma.order.deleteMany({ where: { clubId } })
  await prisma.user.deleteMany({ where: { clubId } })
  await prisma.club.delete({ where: { id: clubId } })
})

describe("payment hardening", () => {
  it("correlates only the exact transaction, amount and currency", async () => {
    const order = await createOrder({ code: "PAY-HARD-MATCH" })
    const attempt = await prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: "IZIPAY",
        providerOrderNumber: "order-payment-hardening",
        providerTransactionId: "tx-payment-hardening",
        amount: 150.25,
        currency: "PEN",
        status: "SESSION_READY",
      },
    })

    await expect(resolveIzipayPaymentContext(parsedPayment())).resolves.toEqual({
      ok: true,
      orderId: order.id,
      attemptId: attempt.id,
      attemptStatus: "SESSION_READY",
      orderStatus: "PENDING",
    })
    await expect(
      resolveIzipayPaymentContext(parsedPayment({ amount: 1 }))
    ).resolves.toMatchObject({ ok: false })
    await expect(
      resolveIzipayPaymentContext(parsedPayment({ currency: "USD" }))
    ).resolves.toMatchObject({ ok: false })
    await expect(
      resolveIzipayPaymentContext(parsedPayment({ transactionId: "another-tx" }))
    ).resolves.toMatchObject({ ok: false })
  })

  it("holds expired attempted payments for reconciliation", async () => {
    const order = await createOrder({
      code: "PAY-HARD-REVIEW",
      expiresAt: new Date(Date.now() - 60_000),
    })
    await prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: "IZIPAY",
        providerOrderNumber: "order-payment-review",
        providerTransactionId: "tx-payment-review",
        amount: 150.25,
        currency: "PEN",
        status: "SESSION_READY",
      },
    })

    await expireStaleOrders()

    await expect(
      prisma.order.findUnique({ where: { id: order.id }, select: { status: true } })
    ).resolves.toEqual({ status: "PENDING" })
    await expect(countOrdersRequiringPaymentReview()).resolves.toBeGreaterThanOrEqual(1)
  })

  it("does not downgrade an approved attempt when callbacks arrive out of order", async () => {
    const order = await createOrder({ code: "PAY-HARD-ORDERING" })
    const attempt = await prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: "IZIPAY",
        providerOrderNumber: "order-payment-ordering",
        providerTransactionId: "tx-payment-ordering",
        amount: 150.25,
        currency: "PEN",
        status: "APPROVED",
      },
    })

    await updateIzipayAttempt({
      attemptId: attempt.id,
      status: "REJECTED",
      parsed: parsedPayment({
        code: "51",
        orderNumber: "order-payment-ordering",
        transactionId: "tx-payment-ordering",
      }),
    })

    await expect(
      prisma.paymentAttempt.findUnique({
        where: { id: attempt.id },
        select: { status: true },
      })
    ).resolves.toEqual({ status: "APPROVED" })
  })

  it("expires untouched orders and rejects a late fulfillment explicitly", async () => {
    const order = await createOrder({
      code: "PAY-HARD-EXPIRE",
      expiresAt: new Date(Date.now() - 60_000),
    })

    await expect(expireStaleOrders()).resolves.toBeGreaterThanOrEqual(1)
    await expect(
      prisma.order.findUnique({ where: { id: order.id }, select: { status: true } })
    ).resolves.toEqual({ status: "CANCELLED" })

    const result = await fulfillPaidOrder({
      orderId: order.id,
      provider: "IZIPAY",
      providerTransactionId: "late-payment",
    })
    expect(result).toEqual({
      success: false,
      error:
        "El pago fue recibido pero la orden requiere conciliación manual. No vuelvas a pagar.",
    })
  })
})
