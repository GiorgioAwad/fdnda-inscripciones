import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { assertOrderAccess } from "@/lib/club-access"
import {
  createIzipaySession,
  getIzipayCheckoutScriptUrl,
  getPaymentsMode,
  resolveIzipayPublicKey,
} from "@/lib/izipay"
import { buildCheckoutConfig, findIzipayConfigViolations } from "@/lib/izipay-config"
import {
  markIzipayAttemptSessionResult,
  storeIzipayOrderCorrelation,
} from "@/lib/izipay-orders"
import { expireStaleOrders, fulfillPaidOrder } from "@/lib/orders"
import { getCanonicalAppUrl } from "@/lib/env"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    if (getPaymentsMode() !== "izipay") {
      return NextResponse.json(
        { success: false, error: "Ruta no disponible" },
        { status: 404 }
      )
    }

    const merchantCode = process.env.IZIPAY_MERCHANT_CODE || ""
    const publicKey = resolveIzipayPublicKey()
    const apiKey = process.env.IZIPAY_API_KEY || ""
    const hashKey = process.env.IZIPAY_HASH_KEY || ""
    const appUrl = getCanonicalAppUrl()

    if (!merchantCode || !apiKey || !hashKey || !publicKey || !appUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Falta configuración Izipay. Revisa IZIPAY_MERCHANT_CODE, IZIPAY_API_KEY, IZIPAY_HASH_KEY, IZIPAY_PUBLIC_KEY y NEXT_PUBLIC_APP_URL.",
        },
        { status: 500 }
      )
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { success: false, error: "No autorizado" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const orderId = typeof body?.orderId === "string" ? body.orderId : ""
    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "Falta orderId" },
        { status: 400 }
      )
    }

    await expireStaleOrders()

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        club: {
          select: {
            name: true,
            contactName: true,
            contactPhone: true,
            contactEmail: true,
          },
        },
        user: { select: { id: true, name: true, email: true } },
      },
    })

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    if (order.clubId !== user.clubId && user.role !== "ADMIN") {
      return NextResponse.json(
        { success: false, error: "No autorizado" },
        { status: 403 }
      )
    }
    if (user.role !== "ADMIN") {
      if (!user.clubId) {
        return NextResponse.json(
          { success: false, error: "No autorizado" },
          { status: 403 }
        )
      }
      try {
        await assertOrderAccess({ ...user, clubId: user.clubId }, order.id)
      } catch {
        return NextResponse.json(
          { success: false, error: "No autorizado" },
          { status: 403 }
        )
      }
    }

    if (order.status === "PAID") {
      return NextResponse.json({
        success: true,
        data: { orderId: order.id, alreadyPaid: true },
      })
    }

    if (order.status !== "PENDING") {
      return NextResponse.json(
        { success: false, error: "La orden no está disponible para pago" },
        { status: 400 }
      )
    }

    const totalAmount = Number(order.totalAmount)
    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      return NextResponse.json(
        { success: false, error: "Monto de orden inválido" },
        { status: 400 }
      )
    }

    // Orden de S/ 0 (p.ej. pruebas gratuitas): se confirma sin pasar por pasarela.
    if (totalAmount === 0) {
      const result = await fulfillPaidOrder({
        orderId: order.id,
        provider: "FREE",
        providerRef: `FREE-${order.id}`,
        providerResponse: { autoApproved: true, reason: "zero_amount" },
      })
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error || "No se pudo confirmar la orden" },
          { status: 500 }
        )
      }
      return NextResponse.json({
        success: true,
        data: { orderId: order.id, alreadyPaid: true, zeroAmount: true },
      })
    }

    const transactionId = `${Date.now()}${order.id
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-24)}`.slice(0, 40)

    const config = buildCheckoutConfig({
      order,
      merchantCode,
      transactionId,
      appUrl,
    })

    const violations = findIzipayConfigViolations(config)
    if (violations.length > 0) {
      console.error("[izipay/session] config con parámetros fuera de regla", {
        orderId: order.id,
        violations,
      })
    }

    const attemptId = await storeIzipayOrderCorrelation({
      orderId: order.id,
      providerOrderNumber: config.order.orderNumber,
      providerTransactionId: transactionId,
      amount: order.totalAmount,
      currency: order.currency,
    })

    const session = await createIzipaySession(config)

    if (!session.success || !session.sessionToken) {
      await markIzipayAttemptSessionResult({
        attemptId,
        ready: false,
        providerResponse: { error: session.error?.slice(0, 300) },
      })
      console.error("[izipay/session] Token/Generate falló", {
        orderId: order.id,
        orderNumber: config.order.orderNumber,
        transactionId,
        violations,
        providerError: session.error,
      })
      return NextResponse.json(
        {
          success: false,
          error: `No pudimos iniciar el pago con Izipay. Vuelve a intentarlo en unos minutos. (Ref: ${config.order.orderNumber})`,
        },
        { status: 502 }
      )
    }

    await markIzipayAttemptSessionResult({ attemptId, ready: true })

    return NextResponse.json({
      success: true,
      data: {
        orderId: order.id,
        authorization: session.sessionToken,
        keyRSA: publicKey,
        scriptUrl: getIzipayCheckoutScriptUrl(),
        config,
      },
    })
  } catch (error) {
    console.error("Izipay session error:", error)
    return NextResponse.json(
      { success: false, error: "Error al iniciar pago con Izipay" },
      { status: 500 }
    )
  }
}
