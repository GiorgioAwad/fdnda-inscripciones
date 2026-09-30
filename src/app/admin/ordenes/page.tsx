import Link from "next/link"
import { AlertTriangle, Receipt, SearchCheck } from "lucide-react"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  countOrdersRequiringPaymentReview,
  expireStaleOrders,
} from "@/lib/orders"
import { formatDateTimeLima, formatMoney, plural } from "@/lib/utils"
import { Badge, ORDER_KIND_BADGE, ORDER_STATUS_BADGE } from "@/components/ui/badge"
import { buttonClasses } from "@/components/ui/button"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

export default async function OrdenesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; review?: string }>
}) {
  const params = await searchParams
  const requestedPage = Math.max(1, Math.trunc(Number(params.page) || 1))
  const onlyReview = params.review === "1"
  await expireStaleOrders()

  const reviewWhere: Prisma.OrderWhereInput = {
    status: "PENDING",
    expiresAt: { lt: new Date() },
    paymentAttempts: {
      some: { status: { in: ["CREATED", "SESSION_READY", "APPROVED", "ERROR"] } },
    },
  }

  const [total, paid, reviewCount] = await Promise.all([
    prisma.order.count({ where: onlyReview ? reviewWhere : undefined }),
    prisma.order.aggregate({
      where: { status: "PAID" },
      _sum: { totalAmount: true },
    }),
    countOrdersRequiringPaymentReview(),
  ])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)
  const orders = await prisma.order.findMany({
      where: onlyReview ? reviewWhere : undefined,
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        club: { select: { name: true } },
        _count: { select: { items: true } },
      },
    })

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        title="Órdenes de pago"
        description={
          <>
            {onlyReview
              ? `${plural(total, "orden", "órdenes")} por conciliar`
              : plural(total, "orden", "órdenes")}{" "}
            · Cobrado en órdenes pagadas:{" "}
            <span className="font-bold text-fdnda-success">
              {formatMoney(paid._sum.totalAmount ?? 0)}
            </span>
          </>
        }
      />

      {/* Sin nada por conciliar, la salida a la lista completa la da el estado
          vacío de abajo (antes la tabla decía «Aún no hay órdenes» y no había
          forma de volver). */}
      {reviewCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-fdnda-warning-ring bg-fdnda-warning-soft p-4 text-sm text-fdnda-warning">
          <span className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            {reviewCount === 1
              ? "1 orden vencida tiene un intento de pago con Izipay y está por conciliar. No liberes sus cupos ni pidas un segundo pago."
              : `${reviewCount} órdenes vencidas tienen un intento de pago con Izipay y están por conciliar. No liberes sus cupos ni pidas un segundo pago.`}
          </span>
          <Link
            href={onlyReview ? "/admin/ordenes" : "/admin/ordenes?review=1"}
            className="inline-flex min-h-11 items-center font-bold underline underline-offset-2"
          >
            {onlyReview
              ? "Mostrar todas las órdenes"
              : `Mostrar solo ${reviewCount === 1 ? "la orden" : `las ${reviewCount}`} por conciliar`}
          </Link>
        </div>
      ) : null}

      {orders.length === 0 ? (
        <div className="rounded-surface border border-fdnda-border bg-white shadow-raised">
          {onlyReview ? (
            <EmptyState
              icon={SearchCheck}
              title="No hay órdenes por conciliar"
              action={
                <Link href="/admin/ordenes" className={buttonClasses({ variant: "outline" })}>
                  Mostrar todas las órdenes
                </Link>
              }
            >
              Ninguna orden vencida tiene un intento de pago con Izipay sin confirmar.
            </EmptyState>
          ) : (
            <EmptyState icon={Receipt} title="Aún no hay órdenes">
              Aparecen aquí cuando un club paga desde el portal su afiliación o una
              planilla de inscripción.
            </EmptyState>
          )}
        </div>
      ) : (
        <TableContainer aria-label="Órdenes de pago">
          <Table>
            <THead>
              <TR>
                <TH>Código</TH>
                <TH>Tipo</TH>
                <TH>Club</TH>
                <TH>Fecha</TH>
                <TH className="text-right">Ítems</TH>
                <TH className="text-right">Total</TH>
                <TH>Proveedor</TH>
                <TH>Referencia</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {orders.map((order) => {
                const badge = ORDER_STATUS_BADGE[order.status]
                const kind = ORDER_KIND_BADGE[order.kind]
                return (
                  <TR key={order.id}>
                    <TD className="num text-xs">
                      <span className="flex flex-wrap items-center gap-2">
                        {order.code}
                        {/* isLegacy: orden histórica que mezcla competencias
                            (ver schema.prisma). «Legado» no le decía nada al admin. */}
                        {order.isLegacy ? (
                          <Badge variant="warning">Varias competencias</Badge>
                        ) : null}
                      </span>
                    </TD>
                    <TD>{kind ? <Badge variant={kind.variant}>{kind.label}</Badge> : "—"}</TD>
                    <TD className="font-medium text-fdnda-ink">{order.club.name}</TD>
                    <TD>{formatDateTimeLima(order.createdAt)}</TD>
                    <TD className="text-right">{order._count.items}</TD>
                    <TD className="text-right font-semibold">
                      {formatMoney(order.totalAmount)}
                    </TD>
                    <TD>{order.provider ?? "—"}</TD>
                    <TD className="num max-w-40 truncate text-xs">
                      {order.providerRef ?? "—"}
                    </TD>
                    <TD>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </TableContainer>
      )}
      <Pagination
        pathname="/admin/ordenes"
        currentPage={currentPage}
        totalPages={totalPages}
        query={{ review: onlyReview ? "1" : undefined }}
        pageSize={PAGE_SIZE}
        totalItems={total}
      />
    </div>
  )
}
