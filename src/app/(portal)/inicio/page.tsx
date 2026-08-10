import Link from "next/link"
import { redirect } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Home,
  MapPin,
  ShoppingBag,
  UserPlus,
} from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  getClubAffiliationPanel,
  isSettledState,
  pendingAffiliationRows,
  type DisciplinePanel,
} from "@/lib/affiliations"
import { clubEventWhere, getClubEventScope } from "@/lib/club-events"
import { DISCIPLINES } from "@/lib/disciplines"
import { formatDateOnly, formatDateTimeLima, formatMoney } from "@/lib/utils"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { disciplineInWhere, explicitDisciplineAccess } from "@/lib/club-access"

export const dynamic = "force-dynamic"

// Un único "próximo paso" en cascada. Antes esta página tenía cuatro bloques
// compitiendo (dos tarjetas con CTA, un banner con otro CTA y tres StatCard que
// repetían los mismos números), y no quedaba claro qué había que hacer primero.
type NextStep = {
  tone: "danger" | "warning" | "ok"
  message: string
  href: string
  cta: string
}

function nextStepFor(input: {
  disciplines: DisciplinePanel[]
  pendingCount: number
  cartCount: number
  activeAthletes: number
}): NextStep {
  const { disciplines, pendingCount, cartCount, activeAthletes } = input

  if (cartCount > 0) {
    return {
      tone: "warning",
      message: `Tienes ${cartCount} afiliación(es) en el carrito sin pagar. Se activan recién al completar el pago.`,
      href: "/afiliacion/carrito",
      cta: "Ir al carrito",
    }
  }

  const clubPending = disciplines.filter(
    (row) => row.fee !== null && !isSettledState(row.clubState)
  )
  if (clubPending.length > 0) {
    const names = clubPending
      .map((row) => DISCIPLINES[row.discipline].label)
      .join(", ")
    return {
      tone: "danger",
      message: `Tu club no tiene vigente la afiliación de ${names}. Solo los clubes al día pueden inscribir en esa disciplina.`,
      href: "/afiliacion",
      cta: "Afiliar al club",
    }
  }

  if (pendingCount > 0) {
    return {
      tone: "warning",
      message: `${pendingCount} afiliación(es) de deportistas por regularizar. Sin ellas no podrás inscribirlos.`,
      href: "/afiliacion?tab=deportistas",
      cta: "Regularizar",
    }
  }

  if (activeAthletes === 0) {
    return {
      tone: "danger",
      message:
        "Ningún deportista tiene una afiliación vigente: agrégalos al padrón y afílialos para poder competir.",
      href: "/deportistas",
      cta: "Ver padrón",
    }
  }

  return {
    tone: "ok",
    message: `Tu club y ${activeAthletes} afiliación(es) de deportistas están al día. Ya puedes inscribir en las competencias abiertas.`,
    href: "/inscripciones",
    cta: "Ver inscripciones",
  }
}

const STEP_STYLE: Record<NextStep["tone"], { box: string; icon: typeof AlertTriangle }> = {
  danger: {
    box: "border-fdnda-red/25 bg-fdnda-red-soft text-fdnda-red-deep",
    icon: AlertTriangle,
  },
  warning: {
    box: "border-fdnda-warning-ring/70 bg-fdnda-warning-soft text-fdnda-warning",
    icon: Clock3,
  },
  ok: {
    box: "border-fdnda-turquoise/25 bg-fdnda-turquoise-soft text-fdnda-navy",
    icon: CheckCircle2,
  },
}

export default async function InicioPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin")
  const access = explicitDisciplineAccess(user)
  const disciplineWhere = disciplineInWhere(user)

  const [panel, scope, cartCount] = await Promise.all([
    getClubAffiliationPanel(user.clubId, access),
    getClubEventScope(user.clubId, access),
    prisma.clubAffiliation
      .count({
        where: {
          clubId: user.clubId,
          status: "PENDING",
          activeOrderId: null,
          ...disciplineWhere,
        },
      })
      .then(async (clubs) =>
        clubs +
        (await prisma.athleteAffiliation.count({
          where: {
            clubId: user.clubId!,
            status: "PENDING",
            activeOrderId: null,
            ...disciplineWhere,
          },
        }))
      ),
  ])

  // El próximo evento se busca solo entre las disciplinas del club: no tiene
  // sentido empujarlo a inscribirse en una competencia que no le corresponde.
  const nextEvent =
    scope.disciplines.length === 0
      ? null
      : await prisma.event.findFirst({
          where: clubEventWhere(scope.disciplines, {
            requireOpen: true,
            requireFutureDeadline: true,
          }),
          orderBy: { registrationDeadline: "asc" },
          include: {
            _count: { select: { modalities: { where: { isActive: true } } } },
          },
        })

  const pendingCount = pendingAffiliationRows(panel.athletes).filter(
    (row) => !row.inCart && !row.awaitingPayment
  ).length

  const step = nextStepFor({
    disciplines: panel.disciplines,
    pendingCount,
    cartCount,
    activeAthletes: panel.totals.active,
  })
  const stepStyle = STEP_STYLE[step.tone]
  const StepIcon = stepStyle.icon

  return (
    <div className="space-y-7">
      <PageHeader
        icon={Home}
        eyebrow="Panel del club"
        title={`Bienvenido, ${user.clubName}`}
        description={
          panel.season
            ? `Resumen de afiliaciones y competencias de la ${panel.season.name.toLowerCase()}.`
            : "La federación aún no habilitó la temporada de afiliaciones."
        }
      />

      {!panel.season ? (
        <Card>
          <EmptyState icon={Clock3} title="Temporada no habilitada">
            La federación todavía no abrió la temporada de afiliaciones. Vuelve a
            consultar pronto.
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Próximo paso: siempre uno solo, con un único CTA. */}
          <div
            role="status"
            className={`flex flex-wrap items-center justify-between gap-3 rounded-surface border px-4 py-4 text-sm font-semibold ${stepStyle.box}`}
          >
            <span className="flex items-start gap-2">
              <StepIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              {step.message}
            </span>
            <Link href={step.href}>
              <Button>
                {step.cta}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </div>

          {/* Estado por disciplina: reemplaza las dos tarjetas y los tres StatCard. */}
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-3 border-b border-fdnda-border py-4">
              <CardTitle>Afiliación {panel.season.year} por disciplina</CardTitle>
              <Link
                href="/afiliacion"
                className="text-sm font-bold text-fdnda-navy underline-offset-4 hover:underline"
              >
                Gestionar
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {panel.disciplines.length === 0 ? (
                <EmptyState icon={Clock3} title="Sin disciplinas habilitadas">
                  La federación aún no fijó las cuotas {panel.season.year}.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-fdnda-border">
                  {panel.disciplines.map((row) => {
                    const style = DISCIPLINES[row.discipline]
                    const Icon = style.icon
                    const badge = AFFILIATION_STATE_BADGE[row.clubState]

                    return (
                      <li
                        key={row.discipline}
                        className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-white ${style.chip}`}
                          >
                            <Icon className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-bold text-fdnda-ink">{style.label}</p>
                            <p className="text-xs text-fdnda-muted">
                              {row.fee
                                ? `Club ${formatMoney(row.fee.clubFee)} · Deportista ${formatMoney(row.fee.athleteFee)}`
                                : "Sin cuota fijada"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <p className="text-right text-xs text-fdnda-muted">
                            Deportistas vigentes
                            <span className="ml-2 text-sm font-bold tabular-nums text-fdnda-navy">
                              {row.counts.active}/{row.counts.total}
                            </span>
                          </p>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Link href="/deportistas">
              <Button variant="outline">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Padrón de deportistas
              </Button>
            </Link>
            <Link href="/afiliacion/carrito">
              <Button variant="ghost">
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                Carrito de afiliación
                {cartCount > 0 ? ` (${cartCount})` : ""}
              </Button>
            </Link>
          </div>
        </>
      )}

      {/* Próximo evento */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-fdnda-border bg-fdnda-navy py-4">
          <CardTitle className="text-white">Próximo evento disponible</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {!nextEvent ? (
            <EmptyState icon={CalendarDays} title="No hay eventos abiertos">
              Por el momento no hay convocatorias con inscripción abierta.
            </EmptyState>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <h3 className="text-lg font-extrabold leading-snug text-fdnda-navy">
                  {nextEvent.name}
                </h3>
                <p className="flex items-center gap-2 text-sm text-fdnda-muted">
                  <CalendarDays className="h-4 w-4 shrink-0 text-fdnda-turquoise-deep" aria-hidden="true" />
                  {formatDateOnly(nextEvent.startDate)} – {formatDateOnly(nextEvent.endDate)}
                </p>
                {nextEvent.venue ? (
                  <p className="flex items-center gap-2 text-sm text-fdnda-muted">
                    <MapPin className="h-4 w-4 shrink-0 text-fdnda-turquoise-deep" aria-hidden="true" />
                    {nextEvent.venue}
                    {nextEvent.city ? `, ${nextEvent.city}` : ""}
                  </p>
                ) : null}
                <p className="flex items-center gap-2 text-sm font-semibold text-fdnda-red-deep">
                  <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Inscripción hasta el {formatDateTimeLima(nextEvent.registrationDeadline)}
                </p>
                <p className="text-sm text-fdnda-muted">
                  {nextEvent._count.modalities} pruebas disponibles
                </p>
              </div>
              <Link href={`/inscripciones/nueva?evento=${encodeURIComponent(nextEvent.slug)}`}>
                <Button>
                  Inscribir ahora
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
