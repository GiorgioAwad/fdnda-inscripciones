import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  PartyPopper,
  Receipt,
  XCircle,
} from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getPaymentsMode } from "@/lib/izipay"
import { expireStaleOrders } from "@/lib/orders"
import { buildOrderSummary } from "@/lib/order-summary"
import { registrationOrderItemView } from "@/lib/registration-snapshots"
import { formatDateTimeLima, formatMoney } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Badge, ORDER_STATUS_BADGE } from "@/components/ui/badge"
import { buttonClasses } from "@/components/ui/button"
import { OrderSummaryView } from "@/components/order-summary-view"
import { PrintButton } from "@/components/print-button"
import { PrintSheetFooter, PrintSheetHeader } from "@/components/print-sheet"
import { MockPaymentPanel } from "./mock-payment-panel"
import { IzipayCheckout } from "./izipay-checkout"
import { PendingOrderPoller } from "./pending-order-poller"
import { assertOrderAccess } from "@/lib/club-access"

export const dynamic = "force-dynamic"

export default async function PagoPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>
  searchParams: Promise<{ message?: string }>
}) {
  const { orderId } = await params
  const { message } = await searchParams

  const user = await getCurrentUser()
  if (!user) redirect("/login")

  await expireStaleOrders()

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      club: { select: { name: true } },
    },
  })

  if (!order) notFound()
  if (user.role !== "ADMIN") {
    if (!user.clubId || order.clubId !== user.clubId) notFound()
    try {
      await assertOrderAccess({ ...user, clubId: user.clubId }, order.id)
    } catch {
      notFound()
    }
  }

  const paymentsMode = getPaymentsMode()
  const itemViews = order.items.map((item) => ({
    id: item.id,
    ...registrationOrderItemView(item),
  }))
  // Comprobante detallado desde los snapshots congelados. Solo aplica a
  // inscripciones: las órdenes de afiliación no llevan snapshot.
  const summary =
    order.kind === "REGISTRATION" ? buildOrderSummary(order.items) : null
  const detailedSummary =
    summary && summary.disciplines.length > 0 ? summary : null
  const frozenClubName =
    summary?.clubName ?? itemViews.find((item) => item.snapshot)?.snapshot?.club.name
  const isRegistration = order.kind === "REGISTRATION"
  const returnHref = isRegistration
    ? order.registrationPlanId
      ? `/inscripciones/${order.registrationPlanId}`
      : "/inscripciones"
    : "/afiliacion"
  const returnLabel = isRegistration
    ? order.registrationPlanId
      ? "Volver a la planilla"
      : "Volver a Inscripciones"
    : "Volver a Estado de afiliación"
  const retryHref = isRegistration ? returnHref : "/afiliacion/carrito"

  // expireStaleOrders ya canceló las vencidas sin intento de pago. Si una sigue
  // PENDING con el plazo cumplido, tuvo un intento con Izipay y quedó reservada
  // para conciliación: ofrecer pagarla otra vez arriesga un doble cobro.
  const inReview = order.status === "PENDING" && order.expiresAt < new Date()
  const badge = inReview
    ? { label: "Por conciliar", variant: "warning" as const }
    : ORDER_STATUS_BADGE[order.status]
  const failed = order.status === "FAILED" || order.status === "CANCELLED"

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PrintSheetHeader
        title={isRegistration ? "Constancia de inscripción" : "Constancia de afiliación"}
        eventName={summary?.event?.name ?? undefined}
        clubName={frozenClubName ?? order.club.name}
        disciplines={detailedSummary?.disciplines.map((row) => row.discipline) ?? []}
        meta={[
          { label: "Orden", value: order.code },
          { label: "Total", value: formatMoney(order.totalAmount) },
          ...(order.paidAt
            ? [{ label: "Pagado", value: formatDateTimeLima(order.paidAt) }]
            : []),
        ]}
      />

      <div className="animate-fade-up">
        {user.role !== "ADMIN" ? (
          <Link
            href={returnHref}
            className="print-hidden mb-2 inline-flex min-h-11 items-center gap-2 rounded-control px-1 text-sm font-bold text-fdnda-muted underline-offset-4 hover:text-fdnda-navy hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {returnLabel}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-control bg-fdnda-navy text-white">
            <Receipt className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-fdnda-navy">
                Orden {order.code}
              </h1>
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {order.isLegacy ? (
                <Badge variant="warning">Varias competencias</Badge>
              ) : null}
            </div>
            <p className="text-sm font-medium text-fdnda-muted">
              {isRegistration ? "Inscripción" : "Afiliación"} ·{" "}
              {frozenClubName ?? order.club.name}
            </p>
          </div>
        </div>
      </div>

      {/* El mensaje llega de la pasarela en la URL. Una vez pagada la orden ya
          no aplica; y solo es un error si la orden falló o expiró. */}
      {message && order.status !== "PAID" && !inReview ? (
        failed ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-surface border border-fdnda-red/25 bg-fdnda-red-soft px-4 py-4 text-sm font-semibold text-fdnda-red-deep"
          >
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {message}
          </div>
        ) : (
          <div
            role="status"
            className="flex items-start gap-2 rounded-surface border border-fdnda-border bg-white px-4 py-4 text-sm font-semibold text-fdnda-navy"
          >
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {message}
          </div>
        )
      ) : null}

      {/* Resumen de items. Las inscripciones tienen snapshot congelado y se
          muestran en detalle; las afiliaciones no, y conservan la lista plana. */}
      {detailedSummary ? (
        <div className="animate-fade-up">
          <OrderSummaryView summary={detailedSummary} total={order.totalAmount} />
        </div>
      ) : (
        <Card className="animate-fade-up overflow-hidden">
          <ul className="divide-y divide-fdnda-border">
            {itemViews.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-3 px-5 py-3.5"
              >
                <p className="min-w-0 flex-1 text-sm text-fdnda-muted">{item.description}</p>
                <span className="shrink-0 text-sm font-extrabold text-fdnda-ink">
                  {formatMoney(item.unitPrice)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-fdnda-border bg-fdnda-sky-soft px-5 py-4">
            <span className="text-sm font-bold uppercase tracking-wide text-fdnda-muted">
              Total
            </span>
            <span className="text-2xl font-extrabold tracking-tight text-fdnda-navy">
              {formatMoney(order.totalAmount)}
            </span>
          </div>
        </Card>
      )}

      {/* Estado / acción según estado de la orden */}
      {order.status === "PAID" ? (
        <div role="status" className="animate-fade-up overflow-hidden rounded-surface border-2 border-fdnda-turquoise bg-white shadow-floating">
          <div className="flex flex-col items-center gap-3 px-6 py-9 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-fdnda-turquoise-soft text-fdnda-navy ring-1 ring-inset ring-fdnda-turquoise/25">
              <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
            </div>
            <p className="flex items-center gap-2 text-lg font-extrabold text-fdnda-navy">
              {isRegistration
                ? "¡Pago confirmado! Tus inscripciones quedaron confirmadas."
                : "¡Pago confirmado! Las afiliaciones ya están vigentes."}
              <PartyPopper className="h-5 w-5 text-fdnda-red" aria-hidden="true" />
            </p>
            <p className="max-w-md text-sm text-fdnda-muted">
              {order.paidAt ? `Pagado el ${formatDateTimeLima(order.paidAt)}. ` : ""}
              Esta página es tu constancia de pago: imprímela o vuelve a ella desde
              Pagos y constancias.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <PrintButton />
              {isRegistration && order.eventId ? (
                <a
                  href={`/api/club/eventos/${order.eventId}/export`}
                  download
                  className={buttonClasses({ variant: "outline", className: "print-hidden" })}
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> Descargar inscripciones en Excel
                </a>
              ) : null}
              {user.role !== "ADMIN" ? (
                <Link
                  href={returnHref}
                  className={buttonClasses({ variant: "outline", className: "print-hidden" })}
                >
                  {returnLabel}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {failed ? (
        <Card className="animate-fade-up border-fdnda-red/25 bg-fdnda-red-soft">
          <div className="flex flex-col items-center gap-2.5 px-6 py-9 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-fdnda-red ring-1 ring-inset ring-fdnda-red/20">
              <XCircle className="h-8 w-8" aria-hidden="true" />
            </div>
            <p className="text-base font-extrabold text-fdnda-red-deep">
              {order.status === "FAILED"
                ? "El pago fue rechazado."
                : "La orden venció sin pagarse."}
            </p>
            <p className="text-sm text-fdnda-red-deep">
              {isRegistration
                ? "La planilla volvió a borrador y liberó sus cupos: puedes pagarla de nuevo desde ahí."
                : "Las afiliaciones volvieron al carrito: puedes pagarlas de nuevo desde ahí."}
            </p>
            {user.role !== "ADMIN" ? (
              <Link href={retryHref} className={buttonClasses({ className: "mt-2" })}>
                {isRegistration ? "Reintentar desde la planilla" : "Reintentar desde el carrito"}
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      {order.status === "PENDING" && inReview ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-surface border border-fdnda-warning-ring/70 bg-fdnda-warning-soft px-4 py-4 text-sm font-semibold text-fdnda-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Estamos confirmando un intento de pago con Izipay. No vuelvas a pagar esta
            orden: la FDNDA la conciliará y esta página mostrará el resultado.
          </span>
        </div>
      ) : null}

      {order.status === "PENDING" && !inReview ? (
        <>
          <PendingOrderPoller expiresAt={order.expiresAt.toISOString()} />
          <div className="flex items-start gap-2 rounded-surface border border-fdnda-border bg-white px-4 py-3 text-xs font-medium leading-5 text-fdnda-muted">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-fdnda-navy" aria-hidden="true" />
            <span>
              Paga antes del {formatDateTimeLima(order.expiresAt)}. Si la orden vence sin
              pagarse,
              {isRegistration
                ? " la planilla vuelve a borrador y sus cupos se liberan."
                : " las afiliaciones vuelven al carrito."}
            </span>
          </div>
          {user.role === "ADMIN" ? (
            <p className="text-sm text-fdnda-muted">
              Estás viendo la orden como administrador: el pago lo hace el club.
            </p>
          ) : paymentsMode === "mock" ? (
            <MockPaymentPanel orderId={order.id} />
          ) : (
            <IzipayCheckout orderId={order.id} totalLabel={formatMoney(order.totalAmount)} />
          )}
        </>
      ) : null}
      <PrintSheetFooter signatureLabel="Recibido conforme · nombre y firma" />
    </div>
  )
}
