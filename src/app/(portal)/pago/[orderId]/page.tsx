import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import {
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
import { Button } from "@/components/ui/button"
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

  const badge = ORDER_STATUS_BADGE[order.status]
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
  const plansHref = order.registrationPlanId
    ? `/inscripciones/${order.registrationPlanId}`
    : "/inscripciones"
  const returnHref = order.kind === "REGISTRATION" ? plansHref : "/afiliacion"

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PrintSheetHeader
        title={
          order.kind === "REGISTRATION"
            ? "Constancia de inscripción"
            : "Constancia de afiliación"
        }
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
        <Link
          href="/inscripciones"
          className="print-hidden mb-2 inline-flex min-h-11 items-center gap-2 rounded-control px-1 text-sm font-bold text-fdnda-muted underline-offset-4 hover:text-fdnda-navy hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Planillas
        </Link>
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
                <Badge variant="warning">Legado multicompetencia</Badge>
              ) : null}
            </div>
            <p className="text-sm font-medium text-fdnda-muted">
              {frozenClubName ?? order.club.name}
            </p>
          </div>
        </div>
      </div>

      {message ? (
        <div role="status" className="rounded-surface border border-fdnda-red/25 bg-fdnda-red-soft px-4 py-4 text-sm font-semibold text-fdnda-red-deep">
          {message}
        </div>
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
              {order.kind === "REGISTRATION"
                ? "¡Pago confirmado! Inscripciones registradas."
                : "¡Pago confirmado! Afiliaciones registradas."}
              <PartyPopper className="h-5 w-5 text-fdnda-red" aria-hidden="true" />
            </p>
            <p className="max-w-md text-sm text-fdnda-muted">
              {order.paidAt ? `Pagado el ${formatDateTimeLima(order.paidAt)}. ` : ""}
              Esta página sirve como constancia de pago.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <PrintButton />
              {order.kind === "REGISTRATION" && order.eventId ? (
                <a
                  href={`/api/club/eventos/${order.eventId}/export`}
                  download
                  className="print-hidden"
                >
                  <Button variant="outline">
                    <Download className="h-4 w-4" aria-hidden="true" /> Descargar Excel
                  </Button>
                </a>
              ) : null}
              <Link href={returnHref} className="print-hidden">
                <Button variant="outline">
                  {order.kind === "REGISTRATION" ? "Ver planilla" : "Ver afiliaciones"}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {order.status === "FAILED" || order.status === "CANCELLED" ? (
        <Card className="animate-fade-up border-fdnda-red/25 bg-fdnda-red-soft">
          <div className="flex flex-col items-center gap-2.5 px-6 py-9 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-fdnda-red ring-1 ring-inset ring-fdnda-red/20">
              <XCircle className="h-8 w-8" aria-hidden="true" />
            </div>
            <p className="text-base font-extrabold text-fdnda-red-deep">
              {order.status === "FAILED"
                ? "El pago no se completó."
                : "La orden expiró sin pagarse."}
            </p>
            <p className="text-sm text-fdnda-red-deep">
              {order.kind === "REGISTRATION"
                ? "La planilla volvió a borrador y liberó sus cupos para que puedas reintentar."
                : "Las afiliaciones volvieron al carrito para que puedas reintentar."}
            </p>
            <Link
              href={order.kind === "REGISTRATION" ? plansHref : "/afiliacion/carrito"}
              className="mt-2"
            >
              <Button>
                {order.kind === "REGISTRATION" ? "Volver a la planilla" : "Volver al carrito"}
              </Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {order.status === "PENDING" ? (
        <>
          <PendingOrderPoller expiresAt={order.expiresAt.toISOString()} />
          <div className="flex items-start gap-2 rounded-surface border border-fdnda-border bg-white px-4 py-3 text-xs font-medium leading-5 text-fdnda-muted">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-fdnda-navy" aria-hidden="true" />
            La orden expira el {formatDateTimeLima(order.expiresAt)}. Si no se paga,
            {order.kind === "REGISTRATION"
              ? " la planilla vuelve a borrador y sus cupos se liberan."
              : " las afiliaciones vuelven al carrito."}
          </div>
          {user.role === "ADMIN" ? (
            <p className="text-sm text-fdnda-muted">
              (Vista de administrador: el pago lo realiza el club.)
            </p>
          ) : paymentsMode === "mock" ? (
            <MockPaymentPanel orderId={order.id} />
          ) : (
            <IzipayCheckout orderId={order.id} />
          )}
        </>
      ) : null}
      <PrintSheetFooter signatureLabel="Recibido conforme · nombre y firma" />
    </div>
  )
}
