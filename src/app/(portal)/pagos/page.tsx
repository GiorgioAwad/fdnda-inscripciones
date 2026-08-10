import Link from "next/link"
import { redirect } from "next/navigation"
import { Receipt } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { expireStaleOrders } from "@/lib/orders"
import { formatDateTimeLima, formatMoney } from "@/lib/utils"
import {
  Badge,
  ORDER_KIND_BADGE,
  ORDER_STATUS_BADGE,
} from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { EmptyState } from "@/components/empty-state"
import { cn } from "@/lib/utils"
import { orderAccessWhere } from "@/lib/club-access"

export const dynamic = "force-dynamic"

const FILTERS = [
  { id: "todos", label: "Todas" },
  { id: "afiliacion", label: "Afiliaciones" },
  { id: "inscripcion", label: "Inscripciones" },
] as const

const KIND_BY_FILTER: Record<string, "AFFILIATION" | "REGISTRATION" | undefined> = {
  afiliacion: "AFFILIATION",
  inscripcion: "REGISTRATION",
}

const PAGE_SIZE = 25

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; page?: string }>
}) {
  const { tipo, page } = await searchParams
  const activeFilter = FILTERS.some((f) => f.id === tipo) ? tipo! : "todos"
  const requestedPage = Math.max(1, Math.trunc(Number(page) || 1))

  const user = await getCurrentUser()
  if (!user) redirect("/login")

  if (!user.clubId) {
    return (
      <Card>
        <EmptyState icon={Receipt} title="Sección de clubes">
          El historial de pagos es de cada club. Usa el panel de órdenes de
          administración.
        </EmptyState>
      </Card>
    )
  }

  await expireStaleOrders()

  const kind = KIND_BY_FILTER[activeFilter]
  const where = {
    clubId: user.clubId,
    ...(kind ? { kind } : {}),
    ...orderAccessWhere(user),
  }
  const total = await prisma.order.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)
  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { _count: { select: { items: true } } },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        eyebrow="Pagos"
        title="Pagos y comprobantes"
        description="Órdenes de afiliación e inscripción de tu club. La orden pagada sirve como constancia."
      />

      <nav aria-label="Filtrar por tipo" className="flex flex-wrap gap-1 border-b border-fdnda-border">
        {FILTERS.map((filter) => {
          const active = filter.id === activeFilter
          return (
            <Link
              key={filter.id}
              href={`/pagos?tipo=${filter.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-semibold transition-colors",
                active
                  ? "border-fdnda-navy text-fdnda-navy"
                  : "border-transparent text-fdnda-muted hover:border-fdnda-sky hover:text-fdnda-navy"
              )}
            >
              {filter.label}
            </Link>
          )
        })}
      </nav>

      {orders.length === 0 ? (
        <Card>
          <EmptyState icon={Receipt} title="Sin órdenes todavía">
            Cuando pagues una afiliación o una inscripción aparecerá aquí.
          </EmptyState>
        </Card>
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>Código</TH>
                <TH>Tipo</TH>
                <TH>Fecha</TH>
                <TH className="text-right">Ítems</TH>
                <TH className="text-right">Total</TH>
                <TH>Estado</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {orders.map((order) => {
                const statusBadge = ORDER_STATUS_BADGE[order.status]
                const kindBadge = ORDER_KIND_BADGE[order.kind]
                return (
                  <TR key={order.id}>
                    <TD className="font-mono text-xs">
                      <span className="flex flex-wrap items-center gap-2">
                        {order.code}
                        {order.isLegacy ? <Badge variant="warning">Legado</Badge> : null}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={kindBadge.variant}>{kindBadge.label}</Badge>
                    </TD>
                    <TD className="text-xs">{formatDateTimeLima(order.createdAt)}</TD>
                    <TD className="text-right tabular-nums">{order._count.items}</TD>
                    <TD className="text-right font-extrabold">
                      {formatMoney(order.totalAmount)}
                    </TD>
                    <TD>
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                    </TD>
                    <TD>
                      <Link
                        href={`/pago/${order.id}`}
                        className="inline-flex min-h-11 items-center rounded-control px-2 text-sm font-bold text-fdnda-navy underline-offset-4 hover:bg-fdnda-sky-soft hover:underline"
                      >
                        {order.status === "PENDING" ? "Pagar" : "Ver constancia"}
                      </Link>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </TableContainer>
      )}
      <Pagination
        pathname="/pagos"
        currentPage={currentPage}
        totalPages={totalPages}
        query={{ tipo: activeFilter }}
      />
    </div>
  )
}
