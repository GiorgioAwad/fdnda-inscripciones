import Link from "next/link"
import { redirect } from "next/navigation"
import { Receipt } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { expireStaleOrders, ORDER_EXPIRATION_MINUTES } from "@/lib/orders"
import { formatDateTimeLima, formatMoney } from "@/lib/utils"
import {
  Badge,
  ORDER_KIND_BADGE,
  ORDER_STATUS_BADGE,
} from "@/components/ui/badge"
import { buttonClasses } from "@/components/ui/button"
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

const EMPTY_BY_FILTER: Record<string, { title: string; body: string }> = {
  todos: {
    title: "Tu club aún no tiene órdenes",
    body: "Cuando pagues una afiliación o una planilla de inscripción, su orden aparecerá aquí.",
  },
  afiliacion: {
    title: "Aún no hay órdenes de afiliación",
    body: "Se crean al pagar el carrito de afiliación.",
  },
  inscripcion: {
    title: "Aún no hay órdenes de inscripción",
    body: "Se crean al pagar una planilla de inscripción.",
  },
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
  // El historial es de cada club; la federación ve todas las órdenes en su panel.
  if (!user.clubId) redirect("/admin/ordenes")

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
  const now = new Date()
  const empty = EMPTY_BY_FILTER[activeFilter] ?? EMPTY_BY_FILTER.todos

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        title="Pagos y constancias"
        description={`Órdenes de afiliación e inscripción de tu club. Una orden sin pagar vence a los ${ORDER_EXPIRATION_MINUTES} minutos; la orden pagada es tu constancia.`}
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
          <EmptyState icon={Receipt} title={empty.title}>
            {empty.body}
          </EmptyState>
        </Card>
      ) : (
        <TableContainer aria-label="Órdenes de pago del club">
          <Table>
            <THead>
              <TR>
                <TH>Código</TH>
                <TH>Tipo</TH>
                <TH>Fecha</TH>
                <TH className="text-right">Ítems</TH>
                <TH className="text-right">Total</TH>
                <TH>Estado</TH>
                <TH>
                  <span className="sr-only">Acción</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {orders.map((order) => {
                // PENDING con el plazo vencido que sigue viva = tuvo un intento
                // de pago con Izipay y quedó por conciliar (no se libera sola).
                const inReview = order.status === "PENDING" && order.expiresAt < now
                const statusBadge = inReview
                  ? { label: "Por conciliar", variant: "warning" as const }
                  : ORDER_STATUS_BADGE[order.status]
                const kindBadge = ORDER_KIND_BADGE[order.kind]
                const retryHref =
                  order.kind === "AFFILIATION"
                    ? "/afiliacion/carrito"
                    : order.registrationPlanId
                      ? `/inscripciones/${order.registrationPlanId}`
                      : "/inscripciones"

                const action =
                  order.status === "PAID"
                    ? { href: `/pago/${order.id}`, label: "Ver constancia", aria: `Ver constancia de la orden ${order.code}` }
                    : order.status === "PENDING"
                      ? inReview
                        ? { href: `/pago/${order.id}`, label: "Revisar orden", aria: `Revisar la orden ${order.code}` }
                        : { href: `/pago/${order.id}`, label: "Pagar orden", aria: `Pagar la orden ${order.code}` }
                      : { href: retryHref, label: "Reintentar", aria: `Reintentar el pago de la orden ${order.code}` }

                return (
                  <TR key={order.id}>
                    <TD className="num text-xs">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/pago/${order.id}`}
                          className="font-semibold text-fdnda-navy underline-offset-4 hover:underline"
                        >
                          {order.code}
                        </Link>
                        {order.isLegacy ? <Badge variant="warning">Varias competencias</Badge> : null}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={kindBadge.variant}>{kindBadge.label}</Badge>
                    </TD>
                    <TD className="text-xs">{formatDateTimeLima(order.createdAt)}</TD>
                    <TD className="num text-right">{order._count.items}</TD>
                    <TD className="text-right font-extrabold">
                      {formatMoney(order.totalAmount)}
                    </TD>
                    <TD>
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                    </TD>
                    <TD>
                      <Link
                        href={action.href}
                        aria-label={action.aria}
                        className={buttonClasses({
                          variant: order.status === "PENDING" && !inReview ? "default" : "ghost",
                          size: "sm",
                        })}
                      >
                        {action.label}
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
