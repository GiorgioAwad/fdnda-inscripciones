import Link from "next/link"
import {
  ArrowRight,
  CalendarDays,
  CalendarX2,
  ClipboardList,
  Clock3,
  Download,
  MapPin,
  ShieldAlert,
  Users,
} from "lucide-react"
import { redirect } from "next/navigation"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { explicitDisciplineAccess } from "@/lib/club-access"
import { Badge, type BadgeVariant } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { clubEventWhere, getClubEventScope } from "@/lib/club-events"
import { disciplineLabel, disciplineStyle } from "@/lib/disciplines"
import { prisma } from "@/lib/prisma"
import { listRegistrationPlans } from "@/lib/registration-plans"
import { formatDateOnly, formatDateTimeLima, formatMoney } from "@/lib/utils"

export const dynamic = "force-dynamic"

const PLANS_PAGE_SIZE = 12

const statusMeta: Record<string, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: "Borrador", variant: "neutral" },
  AWAITING_PAYMENT: { label: "Pago pendiente", variant: "warning" },
  PAID: { label: "Inscripción pagada", variant: "success" },
}

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / (24 * 3600 * 1000))
}

export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const requestedPage = Math.max(
    1,
    Math.trunc(Number((await searchParams).page) || 1)
  )
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin")
  const access = explicitDisciplineAccess(user)
  const eventAccessWhere = access
    ? { disciplineScope: { in: access } }
    : {}

  const visibleStatuses = ["DRAFT", "AWAITING_PAYMENT", "PAID"] as const
  const totalPlans = await prisma.registrationPlan.count({
    where: {
      clubId: user.clubId,
      status: { in: [...visibleStatuses] },
      ...eventAccessWhere,
    },
  })
  const totalPlanPages = Math.max(1, Math.ceil(totalPlans / PLANS_PAGE_SIZE))
  const currentPlanPage = Math.min(requestedPage, totalPlanPages)

  const [plans, activePlans, scope] = await Promise.all([
    listRegistrationPlans(user.clubId, {
      statuses: [...visibleStatuses],
      skip: (currentPlanPage - 1) * PLANS_PAGE_SIZE,
      take: PLANS_PAGE_SIZE,
      disciplineAccess: access,
    }),
    prisma.registrationPlan.findMany({
      where: {
        clubId: user.clubId,
        status: { in: ["DRAFT", "AWAITING_PAYMENT"] },
        eventId: { not: null },
        ...eventAccessWhere,
      },
      select: { id: true, eventId: true, status: true },
      orderBy: { updatedAt: "desc" },
    }),
    getClubEventScope(user.clubId, access),
  ])
  const events =
    scope.disciplines.length === 0
      ? []
      : await prisma.event.findMany({
          where: clubEventWhere(scope.disciplines, {
            requireOpen: true,
            requireFutureDeadline: true,
            requireSeason: true,
          }),
          orderBy: [{ startDate: "asc" }, { name: "asc" }],
          include: {
            _count: { select: { modalities: { where: { isActive: true } } } },
          },
        })

  // Un evento con trabajo pendiente lleva directo a ese trabajo. Si la última
  // inscripción ya fue pagada, el mismo evento permite iniciar un suplemento.
  const activePlanByEventId = new Map<string, (typeof activePlans)[number]>()
  for (const plan of activePlans) {
    if (
      plan.eventId &&
      (plan.status === "DRAFT" || plan.status === "AWAITING_PAYMENT") &&
      !activePlanByEventId.has(plan.eventId)
    ) {
      activePlanByEventId.set(plan.eventId, plan)
    }
  }
  const visiblePlans = plans

  return (
    <div className="space-y-8">
      <PageHeader
        icon={ClipboardList}
        eyebrow="Competencias"
        lanes={scope.disciplines}
        title="Inscripciones"
        description="Elige una competencia para empezar o retoma una inscripción en curso. Todo queda guardado automáticamente."
      />

      <section className="space-y-4" aria-labelledby="open-events-title">
        <div>
          <h2
            id="open-events-title"
            className="font-heading text-2xl text-fdnda-navy"
          >
            Competencias abiertas
          </h2>
          <p className="mt-1 text-sm text-fdnda-muted">
            Selecciona una competencia para inscribir a tus deportistas.
          </p>
        </div>

        {scope.disciplines.length === 0 ? (
          <Card>
            <EmptyState
              icon={ShieldAlert}
              title={
                scope.season
                  ? "Todavía no tienes afiliaciones de esta temporada"
                  : "La temporada aún no está habilitada"
              }
            >
              <p>
                {scope.season
                  ? `Afilia a tu club en la temporada ${scope.season.year} para ver las competencias disponibles.`
                  : "La federación todavía no habilitó la temporada de afiliaciones. Comunícate con la FDNDA."}
              </p>
              {scope.season ? (
                <Link href="/afiliacion" className="mt-4 inline-block">
                  <Button>Ir a afiliación</Button>
                </Link>
              ) : null}
            </EmptyState>
          </Card>
        ) : events.length === 0 ? (
          <Card>
            <EmptyState icon={CalendarX2} title="No hay competencias abiertas">
              Por el momento no hay convocatorias de {scope.disciplines
                .map(disciplineLabel)
                .join(", ")} con el plazo de inscripción vigente.
            </EmptyState>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {events.map((event) => {
              const activePlan = activePlanByEventId.get(event.id)
              const days = daysUntil(event.registrationDeadline)
              const href = activePlan
                ? `/inscripciones/${activePlan.id}`
                : `/inscripciones/nueva?evento=${encodeURIComponent(event.slug)}`
              const action = activePlan ? "Continuar inscripción" : "Inscribir deportistas"

              return (
                <Link
                  key={event.id}
                  href={href}
                  className="group block h-full rounded-surface focus-visible:outline-none"
                  aria-label={`${action} en ${event.name}`}
                >
                  <Card
                    lanes={event.disciplines}
                    className="flex h-full flex-col transition-[border-color,transform,box-shadow] duration-200 group-hover:-translate-y-1 group-hover:border-fdnda-turquoise group-hover:shadow-floating group-focus-visible:ring-4 group-focus-visible:ring-fdnda-sky"
                  >
                    <div className="wave-field flex min-h-20 flex-wrap items-end gap-2 bg-fdnda-navy px-5 pb-4 pt-5">
                      {event.disciplines.map((discipline) => {
                        const style = disciplineStyle(discipline)
                        const Icon = style.icon
                        return (
                          <span
                            key={discipline}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${style.onNavy}`}
                          >
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            {style.label}
                          </span>
                        )
                      })}
                    </div>

                    <article className="flex flex-1 flex-col p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-heading text-xl leading-snug text-fdnda-navy transition-colors group-hover:text-fdnda-turquoise-deep">
                          {event.name}
                        </h3>
                        {activePlan ? (
                          <Badge variant={activePlan.status === "DRAFT" ? "neutral" : "warning"}>
                            {activePlan.status === "DRAFT" ? "En curso" : "Pago pendiente"}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-4 space-y-2 text-sm text-fdnda-muted">
                        <p className="flex items-start gap-2.5">
                          <CalendarDays
                            className="mt-0.5 h-4 w-4 shrink-0 text-fdnda-turquoise-deep"
                            aria-hidden="true"
                          />
                          <span>
                            {formatDateOnly(event.startDate)} – {formatDateOnly(event.endDate)}
                          </span>
                        </p>
                        {event.venue ? (
                          <p className="flex items-start gap-2.5">
                            <MapPin
                              className="mt-0.5 h-4 w-4 shrink-0 text-fdnda-turquoise-deep"
                              aria-hidden="true"
                            />
                            <span>
                              {event.venue}
                              {event.city ? `, ${event.city}` : ""}
                            </span>
                          </p>
                        ) : null}
                      </div>

                      <div className="mt-5 border-t border-fdnda-border pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset ${
                              days <= 3
                                ? "bg-fdnda-red-soft text-fdnda-red-deep ring-fdnda-red/20"
                                : "bg-fdnda-turquoise-soft text-fdnda-turquoise-deep ring-fdnda-turquoise/20"
                            }`}
                          >
                            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                            {days <= 1
                              ? `Cierra hoy · ${formatDateTimeLima(event.registrationDeadline)}`
                              : `Cierra en ${days} días`}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-fdnda-navy">
                            {action}
                            <ArrowRight
                              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                              aria-hidden="true"
                            />
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-fdnda-muted">
                          {event._count.modalities} pruebas disponibles
                        </p>
                      </div>
                    </article>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="registrations-title">
        <div>
          <h2
            id="registrations-title"
            className="font-heading text-2xl text-fdnda-navy"
          >
            Tus inscripciones
          </h2>
          <p className="mt-1 text-sm text-fdnda-muted">
            Revisa borradores, pagos pendientes e inscripciones completadas.
          </p>
        </div>

        {visiblePlans.length === 0 ? (
          <Card>
            <EmptyState icon={Users} title="Aún no has iniciado una inscripción">
              Elige una competencia abierta para comenzar.
            </EmptyState>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visiblePlans.map((plan) => {
              const status = statusMeta[plan.status] ?? statusMeta.DRAFT
              const order = plan.orders[0]
              return (
                <Card
                  key={plan.id}
                  lanes={plan.event?.disciplines ?? []}
                  className="flex flex-col p-5 pt-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-eyebrow uppercase text-fdnda-turquoise-deep">
                        {plan.event
                          ? formatDateOnly(plan.event.startDate)
                          : "Competencia pendiente"}
                      </p>
                      <h3 className="mt-1 font-heading text-xl text-fdnda-navy">
                        {plan.event?.name ?? "Inscripción sin competencia"}
                      </h3>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  {/* Las tres métricas separadas por divisoria en vez de una caja
                      gris: son cifras, y las cifras del sistema se dicen en mono. */}
                  <dl className="mt-4 grid grid-cols-3 divide-x divide-fdnda-border rounded-control border border-fdnda-border">
                    <div className="px-3 py-2.5">
                      <dt className="text-eyebrow uppercase text-fdnda-muted">
                        Deportistas
                      </dt>
                      <dd className="num mt-0.5 text-xl font-bold text-fdnda-navy">
                        {plan._count.athletes}
                      </dd>
                    </div>
                    <div className="px-3 py-2.5">
                      <dt className="text-eyebrow uppercase text-fdnda-muted">Pruebas</dt>
                      <dd className="num mt-0.5 text-xl font-bold text-fdnda-navy">
                        {plan._count.registrations}
                      </dd>
                    </div>
                    <div className="px-3 py-2.5">
                      <dt className="text-eyebrow uppercase text-fdnda-muted">Total</dt>
                      <dd className="num mt-0.5 text-xl font-bold text-fdnda-navy">
                        {order ? formatMoney(order.totalAmount) : "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      href={`/inscripciones/${plan.id}`}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-control border border-fdnda-navy bg-fdnda-navy px-4 text-sm font-semibold text-white hover:bg-fdnda-navy/90"
                    >
                      {plan.status === "DRAFT" ? "Continuar inscripción" : "Ver inscripción"}
                    </Link>
                    {order ? (
                      <Link
                        href={`/pago/${order.id}`}
                        className="inline-flex min-h-11 items-center justify-center rounded-control border border-fdnda-navy/35 bg-white px-4 text-sm font-semibold text-fdnda-navy hover:bg-fdnda-sky/20"
                      >
                        {order.status === "PAID" ? "Ver pago" : "Continuar pago"}
                      </Link>
                    ) : null}
                    {plan.eventId ? (
                      <a
                        href={`/api/club/eventos/${plan.eventId}/export`}
                        download
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-fdnda-border bg-white px-4 text-sm font-semibold text-fdnda-navy hover:bg-fdnda-surface"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" /> Excel
                      </a>
                    ) : null}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
        <Pagination
          pathname="/inscripciones"
          currentPage={currentPlanPage}
          totalPages={totalPlanPages}
        />
      </section>
    </div>
  )
}
