import Link from "next/link"
import {
  AlertTriangle,
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
import { DisciplineIcon } from "@/components/discipline-icon"
import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { explicitDisciplineAccess } from "@/lib/club-access"
import {
  Badge,
  EVENT_DEADLINE_PASSED_BADGE,
  type BadgeVariant,
} from "@/components/ui/badge"
import { buttonClasses } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { clubEventWhere, getClubEventScope } from "@/lib/club-events"
import { disciplineLabel, disciplineStyle } from "@/lib/disciplines"
import { prisma } from "@/lib/prisma"
import { listRegistrationPlans } from "@/lib/registration-plans"
import { formatDateOnly, formatDateTimeLima, formatMoney, plural } from "@/lib/utils"
import { openPlanErrorMessage } from "./open-plan-errors"

export const dynamic = "force-dynamic"

const PLANS_PAGE_SIZE = 12

const statusMeta: Record<string, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: "Borrador", variant: "neutral" },
  AWAITING_PAYMENT: { label: "Pago pendiente", variant: "warning" },
  PAID: { label: "Pagada", variant: "success" },
}

const limaDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
const limaTime = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

// Días de calendario de Lima entre hoy y el cierre. Con horas corridas
// (Math.ceil) un cierre de mañana a las 9:00 visto hoy a las 18:00 decía
// «Cierra hoy».
function calendarDaysUntil(date: Date, now: Date): number {
  const day = (value: Date) => Date.parse(`${limaDay.format(value)}T00:00:00Z`)
  return Math.round((day(date) - day(now)) / (24 * 3600 * 1000))
}

function deadlineLabel(deadline: Date, now: Date): string {
  const days = calendarDaysUntil(deadline, now)
  if (days <= 0) return `Cierra hoy a las ${limaTime.format(deadline)}`
  if (days === 1) return `Cierra mañana a las ${limaTime.format(deadline)}`
  return `Cierra en ${days} días`
}

export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; error?: string }>
}) {
  const params = await searchParams
  const requestedPage = Math.max(1, Math.trunc(Number(params.page) || 1))
  const errorMessage = openPlanErrorMessage(params.error)
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
      select: {
        id: true,
        eventId: true,
        status: true,
        // La orden por pagar: con ella la tarjeta lleva directo al pago.
        orders: {
          where: { status: "PENDING" },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
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
  // planilla ya fue pagada, el mismo evento permite iniciar una suplementaria.
  const activePlanByEventId = new Map<string, (typeof activePlans)[number]>()
  for (const plan of activePlans) {
    if (plan.eventId && !activePlanByEventId.has(plan.eventId)) {
      activePlanByEventId.set(plan.eventId, plan)
    }
  }
  const now = new Date()

  return (
    <div className="space-y-8">
      <PageHeader
        icon={ClipboardList}
        lanes={scope.disciplines}
        title="Inscripciones"
        description="Elige una competencia para inscribir a tus deportistas o retoma una planilla. Cada cambio se guarda solo."
      />

      {errorMessage ? (
        <Card
          role="alert"
          className="flex items-start gap-2 border-fdnda-danger-ring bg-fdnda-danger-soft p-4 text-sm font-semibold text-fdnda-danger"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>No pudimos abrir la planilla. {errorMessage}</p>
        </Card>
      ) : null}

      <section className="space-y-4" aria-labelledby="open-events-title">
        <h2
          id="open-events-title"
          className="scroll-mt-24 font-heading text-2xl text-fdnda-navy"
        >
          Competencias abiertas
        </h2>

        {scope.disciplines.length === 0 ? (
          <Card>
            <EmptyState
              icon={ShieldAlert}
              title={
                scope.season
                  ? `Tu club no tiene afiliaciones vigentes en ${scope.season.year}`
                  : "La temporada de afiliaciones aún no está habilitada"
              }
              action={
                scope.season ? (
                  <Link href="/afiliacion" className={buttonClasses()}>
                    Afiliar a mi club
                  </Link>
                ) : null
              }
            >
              {scope.season
                ? "Solo puedes inscribir en competencias de las disciplinas en las que tu club está afiliado."
                : "La FDNDA todavía no habilitó la temporada. Cuando lo haga, podrás afiliar a tu club e inscribir a tus deportistas."}
            </EmptyState>
          </Card>
        ) : events.length === 0 ? (
          <Card>
            <EmptyState
              icon={CalendarX2}
              title="No hay competencias con inscripción abierta"
              action={
                <Link
                  href="/afiliacion?tab=deportistas"
                  className={buttonClasses({ variant: "outline" })}
                >
                  Revisar afiliación de deportistas
                </Link>
              }
            >
              Cuando la FDNDA abra inscripciones de{" "}
              {scope.disciplines.map(disciplineLabel).join(", ")}, aparecerán aquí.
              Mientras tanto, revisa que tus deportistas estén afiliados.
            </EmptyState>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {events.map((event) => {
              const activePlan = activePlanByEventId.get(event.id)
              const pendingOrderId =
                activePlan?.status === "AWAITING_PAYMENT"
                  ? activePlan.orders[0]?.id
                  : undefined
              const days = calendarDaysUntil(event.registrationDeadline, now)
              const href = pendingOrderId
                ? `/pago/${pendingOrderId}`
                : activePlan
                  ? `/inscripciones/${activePlan.id}`
                  : `/inscripciones/nueva?evento=${encodeURIComponent(event.slug)}`
              const action = pendingOrderId
                ? "Pagar orden pendiente"
                : activePlan
                  ? activePlan.status === "DRAFT"
                    ? "Continuar planilla"
                    : "Ver planilla"
                  : "Inscribir deportistas"
              const titleId = `event-${event.id}-title`
              const deadlineId = `event-${event.id}-deadline`
              const actionId = `event-${event.id}-action`

              return (
                <Link
                  key={event.id}
                  href={href}
                  className="group block h-full rounded-surface focus-visible:outline-none"
                  aria-labelledby={`${actionId} ${titleId} ${deadlineId}`}
                >
                  <Card
                    lanes={event.disciplines}
                    className="flex h-full flex-col transition-[border-color,transform,box-shadow] duration-200 group-hover:-translate-y-1 group-hover:border-fdnda-turquoise group-hover:shadow-floating group-focus-visible:ring-4 group-focus-visible:ring-fdnda-sky"
                  >
                    <div className="wave-field flex min-h-20 flex-wrap items-end gap-2 bg-fdnda-navy px-5 pb-4 pt-5">
                      {event.disciplines.map((discipline) => {
                        const style = disciplineStyle(discipline)
                        return (
                          <span
                            key={discipline}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${style.onNavy}`}
                          >
                            <DisciplineIcon
                              discipline={discipline}
                              tone={style.onNavyPictogramTone}
                              className="h-3.5 w-3.5"
                            />
                            {style.label}
                          </span>
                        )
                      })}
                    </div>

                    <article className="flex flex-1 flex-col p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <h3
                          id={titleId}
                          className="font-heading text-xl leading-snug text-fdnda-navy transition-colors group-hover:text-fdnda-turquoise-deep"
                        >
                          {event.name}
                        </h3>
                        {activePlan ? (
                          <Badge variant={statusMeta[activePlan.status].variant}>
                            {statusMeta[activePlan.status].label}
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
                            id={deadlineId}
                            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset ${
                              days <= 3
                                ? "bg-fdnda-red-soft text-fdnda-red-deep ring-fdnda-red/20"
                                : "bg-fdnda-turquoise-soft text-fdnda-turquoise-deep ring-fdnda-turquoise/20"
                            }`}
                          >
                            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                            {deadlineLabel(event.registrationDeadline, now)}
                          </span>
                          <span
                            id={actionId}
                            className="inline-flex items-center gap-1.5 text-sm font-extrabold text-fdnda-navy"
                          >
                            {action}
                            <ArrowRight
                              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                              aria-hidden="true"
                            />
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-fdnda-muted">
                          {plural(event._count.modalities, "prueba disponible", "pruebas disponibles")}
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
        <h2
          id="registrations-title"
          className="font-heading text-2xl text-fdnda-navy"
        >
          Tus planillas
        </h2>

        {plans.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="Aún no tienes planillas"
              action={
                events.length > 0 ? (
                  <Link
                    href="#open-events-title"
                    className={buttonClasses({ variant: "outline" })}
                  >
                    Elegir una competencia abierta
                  </Link>
                ) : null
              }
            >
              Una planilla reúne a los deportistas que inscribes en una competencia
              y sus pruebas. Se crea al elegir una competencia abierta.
            </EmptyState>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => {
              const status = statusMeta[plan.status] ?? statusMeta.DRAFT
              const order = plan.orders[0]
              const closed =
                plan.status === "DRAFT" &&
                plan.event !== null &&
                (plan.event.status !== "OPEN" || plan.event.registrationDeadline < now)
              const eventName = plan.event?.name ?? "Planilla sin competencia"
              return (
                <Card
                  key={plan.id}
                  lanes={plan.event?.disciplines ?? []}
                  className="flex flex-col p-5 pt-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-heading text-xl text-fdnda-navy">{eventName}</h3>
                      {plan.event ? (
                        <p className="mt-1 text-sm text-fdnda-muted">
                          {formatDateOnly(plan.event.startDate)} –{" "}
                          {formatDateOnly(plan.event.endDate)}
                          {plan.status === "DRAFT" && !closed
                            ? ` · Inscripción hasta el ${formatDateTimeLima(plan.event.registrationDeadline)}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      {closed ? (
                        <Badge variant={EVENT_DEADLINE_PASSED_BADGE.variant}>
                          {EVENT_DEADLINE_PASSED_BADGE.label}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {/* Las tres métricas separadas por divisoria en vez de una caja
                      gris: son cifras, y las cifras del sistema se dicen en mono. */}
                  <dl className="mt-4 grid grid-cols-3 divide-x divide-fdnda-border rounded-control border border-fdnda-border">
                    <div className="px-3 py-2.5">
                      <dt className="text-xs font-semibold text-fdnda-muted">Deportistas</dt>
                      <dd className="num mt-0.5 text-xl font-bold text-fdnda-navy">
                        {plan._count.athletes}
                      </dd>
                    </div>
                    <div className="px-3 py-2.5">
                      <dt className="text-xs font-semibold text-fdnda-muted">
                        Pruebas inscritas
                      </dt>
                      <dd className="num mt-0.5 text-xl font-bold text-fdnda-navy">
                        {plan._count.registrations}
                      </dd>
                    </div>
                    <div className="px-3 py-2.5">
                      <dt className="text-xs font-semibold text-fdnda-muted">Total</dt>
                      <dd
                        className={
                          order
                            ? "num mt-0.5 text-xl font-bold text-fdnda-navy"
                            : "mt-1 text-xs font-semibold text-fdnda-muted"
                        }
                      >
                        {order ? formatMoney(order.totalAmount) : "Se calcula al revisar"}
                      </dd>
                    </div>
                  </dl>
                  {closed ? (
                    <p className="mt-3 text-xs font-semibold text-fdnda-ink">
                      Las inscripciones de esta competencia cerraron: esta planilla ya no
                      se puede pagar.
                    </p>
                  ) : null}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {plan.status === "AWAITING_PAYMENT" && order ? (
                      <>
                        <Link
                          href={`/pago/${order.id}`}
                          className={buttonClasses({ className: "flex-1" })}
                        >
                          Pagar orden
                        </Link>
                        <Link
                          href={`/inscripciones/${plan.id}`}
                          className={buttonClasses({ variant: "outline" })}
                        >
                          Ver planilla
                        </Link>
                      </>
                    ) : plan.status === "PAID" && order ? (
                      <>
                        <Link
                          href={`/pago/${order.id}`}
                          className={buttonClasses({ className: "flex-1" })}
                        >
                          Ver constancia
                        </Link>
                        <Link
                          href={`/inscripciones/${plan.id}`}
                          className={buttonClasses({ variant: "outline" })}
                        >
                          Ver planilla
                        </Link>
                      </>
                    ) : (
                      <Link
                        href={`/inscripciones/${plan.id}`}
                        className={buttonClasses({
                          variant: closed ? "outline" : "default",
                          className: "flex-1",
                        })}
                      >
                        {closed || plan.status !== "DRAFT" ? "Ver planilla" : "Continuar planilla"}
                      </Link>
                    )}
                    {plan.eventId && order ? (
                      <a
                        href={`/api/club/eventos/${plan.eventId}/export`}
                        download
                        title={`Todas las inscripciones de tu club en ${eventName}`}
                        className={buttonClasses({ variant: "ghost" })}
                      >
                        <Download className="h-4 w-4" aria-hidden="true" /> Descargar
                        reporte (Excel)
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
