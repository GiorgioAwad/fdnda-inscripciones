import Link from "next/link"
import { AlertTriangle, Receipt } from "lucide-react"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  countOrdersRequiringPaymentReview,
  expireStaleOrders,
} from "@/lib/orders"
import { formatDateTimeLima, formatMoney } from "@/lib/utils"
import { Badge, ORDER_STATUS_BADGE } from "@/components/ui/badge"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
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
            {total} órdenes · Total cobrado:{" "}
            <span className="font-bold text-fdnda-success">
              {formatMoney(paid._sum.totalAmount ?? 0)}
            </span>
          </>
        }
      />

      {reviewCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-fdnda-warning-ring bg-fdnda-warning-soft p-4 text-sm text-fdnda-warning">
          <span className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            {reviewCount} orden(es) vencidas tienen un intento de pago y requieren
            conciliación con Izipay. No liberes sus cupos ni pidas un segundo pago.
          </span>
          <Link
            href={onlyReview ? "/admin/ordenes" : "/admin/ordenes?review=1"}
            className="font-bold underline"
          >
            {onlyReview ? "Ver todas" : "Ver pendientes"}
          </Link>
        </div>
      ) : null}

      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH>Código</TH>
              <TH>Club</TH>
              <TH>Fecha</TH>
              <TH className="text-right">Inscripciones</TH>
              <TH className="text-right">Total</TH>
              <TH>Proveedor</TH>
              <TH>Referencia</TH>
              <TH>Estado</TH>
            </TR>
          </THead>
          <TBody>
            {orders.length === 0 ? (
              <TR>
                <TD colSpan={8} className="py-10 text-center text-fdnda-muted">
                  Aún no hay órdenes.
                </TD>
              </TR>
            ) : (
              orders.map((order) => {
                const badge = ORDER_STATUS_BADGE[order.status]
                return (
                  <TR key={order.id}>
                    <TD className="font-mono text-xs">
                      <span className="flex flex-wrap items-center gap-2">
                        {order.code}
                        {order.isLegacy ? <Badge variant="warning">Legado</Badge> : null}
                      </span>
                    </TD>
                    <TD className="font-medium text-fdnda-ink">{order.club.name}</TD>
                    <TD>{formatDateTimeLima(order.createdAt)}</TD>
                    <TD className="text-right">{order._count.items}</TD>
                    <TD className="text-right font-semibold">
                      {formatMoney(order.totalAmount)}
                    </TD>
                    <TD>{order.provider ?? "—"}</TD>
                    <TD className="max-w-40 truncate font-mono text-xs">
                      {order.providerRef ?? "—"}
                    </TD>
                    <TD>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TD>
                  </TR>
                )
              })
            )}
          </TBody>
        </Table>
      </TableContainer>
      <Pagination
        pathname="/admin/ordenes"
        currentPage={currentPage}
        totalPages={totalPages}
        query={{ review: onlyReview ? "1" : undefined }}
      />
    </div>
  )
}
