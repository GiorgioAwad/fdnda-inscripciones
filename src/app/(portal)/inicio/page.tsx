import Link from "next/link"
import { redirect } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Info,
  MapPin,
} from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  getClubAffiliationPanel,
  isSettledState,
  pendingAffiliationRows,
} from "@/lib/affiliations"
import { clubEventWhere, getClubEventScope } from "@/lib/club-events"
import { DISCIPLINES } from "@/lib/disciplines"
import {
  cn,
  formatDateOnly,
  formatDateTimeLima,
  formatMoney,
  plural,
} from "@/lib/utils"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { buttonClasses } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DisciplineIcon } from "@/components/discipline-icon"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { GuideLauncher } from "@/components/onboarding/guide"
import { disciplineInWhere, explicitDisciplineAccess } from "@/lib/club-access"

export const dynamic = "force-dynamic"

const listFormat = new Intl.ListFormat("es", { type: "conjunction" })

type Cta = { href: string; label: string }

// ==================== PRIMEROS PASOS ====================
//
// Un club nuevo tiene que recorrer cuatro tareas en orden para llegar a su
// primera inscripción pagada. Cada paso se calcula con datos reales, así que se
// marca solo, y el que toca ahora trae su única acción. Cuando el club ya pagó
// una planilla la lista desaparece: desde ahí lo que necesita es el aviso de
// «qué sigue» de cada temporada, no un tutorial.

type StepStatus = "done" | "current" | "upcoming" | "blocked"

interface FirstStep {
  title: string
  status: StepStatus
  // Una línea bajo el título en su carril: el resultado si está hecho, el
  // motivo si está bloqueado.
  summary: string
  detail?: string
  cta?: Cta
}

type DraftStep = Omit<FirstStep, "status"> & {
  state: "done" | "actionable" | "waiting" | "blocked"
}

function resolveSteps(drafts: DraftStep[]): FirstStep[] {
  const currentIndex = drafts.findIndex((step) => step.state === "actionable")
  return drafts.map((step, index) => ({
    ...step,
    status:
      step.state === "done"
        ? "done"
        : step.state === "blocked"
          ? "blocked"
          : index === currentIndex
            ? "current"
            : "upcoming",
  }))
}

// ==================== AVISO DE LA TEMPORADA ====================
//
// Para el club que ya compitió: un único «qué sigue» en cascada, con una sola
// acción. Reemplaza a los cuatro bloques que competían por la atención.

type Notice = {
  tone: "danger" | "warning" | "ok" | "info"
  message: string
  cta?: Cta
}

const NOTICE_STYLE: Record<Notice["tone"], { box: string; icon: typeof AlertTriangle }> = {
  danger: {
    box: "border-fdnda-danger-ring bg-fdnda-danger-soft text-fdnda-danger",
    icon: AlertTriangle,
  },
  warning: {
    box: "border-fdnda-warning-ring bg-fdnda-warning-soft text-fdnda-warning",
    icon: Clock3,
  },
  ok: {
    box: "border-fdnda-success-ring bg-fdnda-success-soft text-fdnda-success",
    icon: CheckCircle2,
  },
  info: {
    box: "border-fdnda-info-ring bg-fdnda-info-soft text-fdnda-info",
    icon: Info,
  },
}

export default async function InicioPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin")
  const clubId = user.clubId
  const access = explicitDisciplineAccess(user)
  const disciplineWhere = disciplineInWhere(user)
  const now = new Date()

  const [panel, scope] = await Promise.all([
    getClubAffiliationPanel(clubId, access),
    getClubEventScope(clubId, access),
  ])
  const season = panel.season

  const [
    cartCount,
    athleteCount,
    affiliationOrder,
    paidRegistrations,
    openPlan,
    nextEvent,
  ] = await Promise.all([
    // Solo la temporada vigente: antes contaba cuotas pendientes de temporadas
    // pasadas, anunciaba un carrito que al abrirlo estaba vacío y tapaba todos
    // los demás pasos.
    season
      ? Promise.all([
          prisma.clubAffiliation.count({
            where: {
              clubId,
              seasonId: season.id,
              status: "PENDING",
              activeOrderId: null,
              ...disciplineWhere,
            },
          }),
          prisma.athleteAffiliation.count({
            where: {
              clubId,
              seasonId: season.id,
              status: "PENDING",
              activeOrderId: null,
              ...disciplineWhere,
            },
          }),
        ]).then(([clubs, athletes]) => clubs + athletes)
      : 0,
    prisma.athlete.count({
      where: {
        clubId,
        isActive: true,
        ...(access ? { disciplines: { hasSome: [...access] } } : {}),
      },
    }),
    prisma.order.findFirst({
      where: { clubId, kind: "AFFILIATION", status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    prisma.order.count({
      where: { clubId, kind: "REGISTRATION", status: "PAID" },
    }),
    prisma.registrationPlan.findFirst({
      where: {
        clubId,
        ...(access ? { disciplineScope: { in: [...access] } } : {}),
        OR: [
          { status: "AWAITING_PAYMENT" },
          {
            status: "DRAFT",
            event: { status: "OPEN", registrationDeadline: { gte: now } },
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        event: { select: { name: true, registrationDeadline: true } },
        orders: { where: { status: "PENDING" }, select: { id: true }, take: 1 },
      },
    }),
    // Solo entre las disciplinas del club: no tiene sentido empujarlo a una
    // competencia que no le corresponde.
    scope.disciplines.length === 0
      ? null
      : prisma.event.findFirst({
          where: clubEventWhere(scope.disciplines, {
            requireOpen: true,
            requireFutureDeadline: true,
          }),
          orderBy: { registrationDeadline: "asc" },
          include: {
            _count: { select: { modalities: { where: { isActive: true } } } },
          },
        }),
  ])

  const feeDisciplines = panel.disciplines.filter((row) => row.fee !== null)
  const settledClub = panel.disciplines.filter((row) => isSettledState(row.clubState))
  // Una fila de deportista solo se puede afiliar si su disciplina tiene cuota
  // fijada: las demás no son una tarea del club, son una espera.
  const athleteRows = pendingAffiliationRows(panel.athletes).filter((row) =>
    panel.fees.has(row.discipline)
  )
  const athletesToAffiliate = athleteRows.filter(
    (row) => !row.inCart && !row.awaitingPayment
  )
  const payOrder: Cta = {
    href: affiliationOrder ? `/pago/${affiliationOrder.id}` : "/pagos",
    label: "Pagar orden",
  }
  const payCart: Cta = { href: "/afiliacion/carrito", label: "Pagar carrito" }
  const planOrderId = openPlan?.orders[0]?.id
  const labels = (rows: { discipline: keyof typeof DISCIPLINES }[]) =>
    listFormat.format(rows.map((row) => DISCIPLINES[row.discipline].label))

  // ---- Paso 1: afiliar al club
  let clubStep: DraftStep
  if (!season) {
    clubStep = {
      title: "Afilia a tu club",
      state: "blocked",
      summary: "La temporada aún no abre",
    }
  } else if (settledClub.length > 0) {
    clubStep = {
      title: "Afilia a tu club",
      state: "done",
      summary: `Vigente en ${labels(settledClub)}`,
    }
  } else if (feeDisciplines.length === 0) {
    clubStep = {
      title: "Afilia a tu club",
      state: "blocked",
      summary: `Cuotas ${season.year} sin fijar`,
    }
  } else if (panel.disciplines.some((row) => row.clubAwaitingPayment)) {
    clubStep = {
      title: "Afilia a tu club",
      state: "actionable",
      summary: "Orden por pagar",
      detail:
        "La cuota de tu club está en una orden por pagar. Complétala antes de que venza; si no, vuelve al carrito.",
      cta: payOrder,
    }
  } else if (panel.disciplines.some((row) => row.clubInCart)) {
    clubStep = {
      title: "Afilia a tu club",
      state: "actionable",
      summary: "En el carrito",
      detail:
        "La cuota de tu club está en el carrito. Págala para que la afiliación quede vigente.",
      cta: payCart,
    }
  } else {
    clubStep = {
      title: "Afilia a tu club",
      state: "actionable",
      summary: "Sin afiliar",
      detail:
        "Paga la cuota de afiliación de cada disciplina que practica tu club. Mientras no esté vigente, no verás sus competencias.",
      cta: { href: "/afiliacion", label: "Afiliar a mi club" },
    }
  }

  // ---- Paso 2: registrar deportistas
  const athletesStep: DraftStep =
    athleteCount > 0
      ? {
          title: "Registra a tus deportistas",
          state: "done",
          summary: plural(athleteCount, "deportista en el padrón", "deportistas en el padrón"),
        }
      : {
          title: "Registra a tus deportistas",
          state: "actionable",
          summary: "Padrón vacío",
          detail:
            "Regístralos con su número de documento. Revisa la fecha de nacimiento y el sexo antes de guardar: después solo la FDNDA puede corregirlos.",
          cta: { href: "/deportistas", label: "Registrar deportistas" },
        }

  // ---- Paso 3: afiliar deportistas
  let athleteAffiliationStep: DraftStep
  if (!season) {
    athleteAffiliationStep = {
      title: "Afilia a tus deportistas",
      state: "blocked",
      summary: "La temporada aún no abre",
    }
  } else if (panel.totals.active > 0) {
    athleteAffiliationStep = {
      title: "Afilia a tus deportistas",
      state: "done",
      summary: plural(panel.totals.active, "afiliación vigente", "afiliaciones vigentes"),
    }
  } else if (athleteCount === 0) {
    athleteAffiliationStep = {
      title: "Afilia a tus deportistas",
      state: "waiting",
      summary: "Primero registra deportistas",
    }
  } else if (athleteRows.some((row) => row.awaitingPayment)) {
    athleteAffiliationStep = {
      title: "Afilia a tus deportistas",
      state: "actionable",
      summary: "Orden por pagar",
      detail:
        "Las afiliaciones de tus deportistas están en una orden por pagar. Complétala antes de que venza; si no, vuelven al carrito.",
      cta: payOrder,
    }
  } else if (athleteRows.some((row) => row.inCart)) {
    athleteAffiliationStep = {
      title: "Afilia a tus deportistas",
      state: "actionable",
      summary: "En el carrito",
      detail:
        "Las afiliaciones de tus deportistas están en el carrito. Págalas para que queden vigentes y puedas inscribirlos.",
      cta: payCart,
    }
  } else if (athletesToAffiliate.length > 0) {
    athleteAffiliationStep = {
      title: "Afilia a tus deportistas",
      state: "actionable",
      summary: plural(athletesToAffiliate.length, "afiliación pendiente", "afiliaciones pendientes"),
      detail:
        "Cada deportista se afilia en cada disciplina que practica. Sin afiliación vigente no podrás inscribirlo en una competencia.",
      cta: { href: "/afiliacion?tab=deportistas", label: "Afiliar deportistas" },
    }
  } else {
    athleteAffiliationStep = {
      title: "Afilia a tus deportistas",
      state: "blocked",
      summary: `Cuotas ${season.year} sin fijar`,
    }
  }

  // ---- Paso 4: primera inscripción
  let entryStep: DraftStep
  if (paidRegistrations > 0) {
    entryStep = {
      title: "Inscribe en una competencia",
      state: "done",
      summary: "Planilla pagada",
    }
  } else if (openPlan?.status === "AWAITING_PAYMENT") {
    entryStep = {
      title: "Inscribe en una competencia",
      state: "actionable",
      summary: "Orden por pagar",
      detail: `Tu planilla de ${openPlan.event?.name ?? "la competencia"} tiene una orden por pagar. Mientras no se pague, las inscripciones no quedan confirmadas.`,
      cta: planOrderId
        ? { href: `/pago/${planOrderId}`, label: "Pagar orden" }
        : { href: `/inscripciones/${openPlan.id}`, label: "Ver planilla" },
    }
  } else if (openPlan?.event) {
    entryStep = {
      title: "Inscribe en una competencia",
      state: "actionable",
      summary: "Planilla en borrador",
      detail: `Tienes una planilla en borrador para ${openPlan.event.name}. La inscripción cierra el ${formatDateTimeLima(openPlan.event.registrationDeadline)}.`,
      cta: { href: `/inscripciones/${openPlan.id}`, label: "Continuar planilla" },
    }
  } else if (panel.totals.active === 0) {
    entryStep = {
      title: "Inscribe en una competencia",
      state: "waiting",
      summary: "Primero afilia a tus deportistas",
    }
  } else if (nextEvent) {
    entryStep = {
      title: "Inscribe en una competencia",
      state: "actionable",
      summary: "Competencia abierta",
      detail: `${nextEvent.name} recibe inscripciones hasta el ${formatDateTimeLima(nextEvent.registrationDeadline)}. Arma la planilla con tus deportistas y sus pruebas.`,
      cta: {
        href: `/inscripciones/nueva?evento=${encodeURIComponent(nextEvent.slug)}`,
        label: "Armar planilla",
      },
    }
  } else {
    entryStep = {
      title: "Inscribe en una competencia",
      state: "waiting",
      summary: "Sin competencias abiertas",
    }
  }

  const showFirstSteps = paidRegistrations === 0
  const steps = resolveSteps([clubStep, athletesStep, athleteAffiliationStep, entryStep])

  // ---- Aviso de temporada (clubes que ya compitieron)
  const clubPending = panel.disciplines.filter(
    (row) =>
      row.fee !== null &&
      !isSettledState(row.clubState) &&
      !row.clubInCart &&
      !row.clubAwaitingPayment
  )
  let notice: Notice
  if (!season) {
    notice = {
      tone: "info",
      message:
        "La FDNDA aún no abre la temporada de afiliaciones. Mientras tanto, puedes registrar a tus deportistas.",
      cta: { href: "/deportistas", label: "Registrar deportistas" },
    }
  } else if (cartCount > 0) {
    notice = {
      tone: "warning",
      message: `Tienes ${plural(cartCount, "afiliación", "afiliaciones")} en el carrito. Se activan recién al completar el pago.`,
      cta: payCart,
    }
  } else if (affiliationOrder) {
    notice = {
      tone: "warning",
      message:
        "Tienes una orden de afiliación por pagar. Complétala antes de que venza o sus afiliaciones volverán al carrito.",
      cta: payOrder,
    }
  } else if (clubPending.length > 0) {
    notice = {
      tone: "danger",
      message: `Tu club no tiene vigente la afiliación de ${labels(clubPending)} en la ${season.name.toLowerCase()}. Sin ella no puede inscribir en ${clubPending.length === 1 ? "esa disciplina" : "esas disciplinas"}.`,
      cta: { href: "/afiliacion", label: "Afiliar a mi club" },
    }
  } else if (athletesToAffiliate.length > 0) {
    notice = {
      tone: "warning",
      message: `${plural(athletesToAffiliate.length, "afiliación de deportista pendiente", "afiliaciones de deportistas pendientes")}. Sin afiliación vigente no podrás inscribirlos.`,
      cta: { href: "/afiliacion?tab=deportistas", label: "Afiliar deportistas" },
    }
  } else if (openPlan?.status === "AWAITING_PAYMENT" && planOrderId) {
    notice = {
      tone: "warning",
      message: `Tu planilla de ${openPlan.event?.name ?? "la competencia"} tiene una orden por pagar.`,
      cta: { href: `/pago/${planOrderId}`, label: "Pagar orden" },
    }
  } else {
    notice = {
      tone: "ok",
      message: `Tu club y ${plural(panel.totals.active, "afiliación de deportista", "afiliaciones de deportistas")} están al día para la ${season.name.toLowerCase()}.`,
      cta: openPlan?.event
        ? { href: `/inscripciones/${openPlan.id}`, label: "Continuar planilla" }
        : { href: "/inscripciones", label: "Inscribir en una competencia" },
    }
  }

  // El club puede armar una planilla cuando al menos una disciplina suya está
  // vigente y tiene deportistas afiliados. Si no, la tarjeta de la competencia
  // no ofrece un botón que terminaría en errores de validación.
  const readyToEnter = settledClub.length > 0 && panel.totals.active > 0

  return (
    <div className="space-y-7">
      <PageHeader
        lanes={panel.disciplines.map((row) => row.discipline)}
        title={user.clubName ?? "Mi club"}
        description={
          season
            ? `${season.name} · afiliaciones vigentes hasta el ${formatDateOnly(season.endDate)}`
            : "La temporada de afiliaciones aún no abre"
        }
      />

      {showFirstSteps ? (
        <FirstSteps steps={steps} seasonOpen={Boolean(season)} />
      ) : (
        <SeasonNotice notice={notice} />
      )}

      {season && panel.disciplines.length > 0 ? (
        <Card lanes={panel.disciplines.map((row) => row.discipline)} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fdnda-border px-5 pb-4 pt-5">
            <h2 className="font-heading text-lg font-bold text-fdnda-navy">
              Afiliación {season.year} por disciplina
            </h2>
            <Link
              href="/afiliacion"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-fdnda-navy underline-offset-4 hover:underline"
            >
              Estado de afiliación
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <ul className="divide-y divide-fdnda-border">
            {panel.disciplines.map((row) => {
              const style = DISCIPLINES[row.discipline]
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
                      <DisciplineIcon
                        discipline={row.discipline}
                        tone="light"
                        className="h-5 w-5"
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold text-fdnda-ink">{style.label}</p>
                      <p className="text-xs text-fdnda-muted">
                        {row.fee
                          ? `Cuota del club ${formatMoney(row.fee.clubFee)} · por deportista ${formatMoney(row.fee.athleteFee)}`
                          : `La FDNDA aún no fijó la cuota ${season.year}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-right text-xs text-fdnda-muted">
                      Deportistas vigentes
                      <span className="num ml-2 text-base font-bold text-fdnda-navy">
                        {row.counts.active}/{row.counts.total}
                      </span>
                    </p>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b border-fdnda-border bg-fdnda-navy px-5 py-4">
          <h2 className="font-heading text-lg font-bold text-white">
            Próxima competencia de tu club
          </h2>
        </div>
        {!scope.hasAnyAffiliation ? (
          <EmptyState
            icon={CalendarDays}
            title="Afilia a tu club para ver competencias"
            action={
              season ? (
                <Link href="/afiliacion" className={buttonClasses({ variant: "outline" })}>
                  Afiliar a mi club
                </Link>
              ) : null
            }
          >
            Solo ves las competencias de las disciplinas en las que tu club está
            afiliado.
          </EmptyState>
        ) : !nextEvent ? (
          <EmptyState icon={CalendarDays} title="No hay competencias abiertas">
            Cuando la FDNDA abra inscripciones en{" "}
            {listFormat.format(scope.disciplines.map((value) => DISCIPLINES[value].label))},
            aparecerán aquí.
          </EmptyState>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div className="min-w-0 space-y-2">
              <p className="text-lg font-bold leading-snug text-fdnda-navy">
                {nextEvent.name}
              </p>
              <p className="flex items-center gap-2 text-sm text-fdnda-muted">
                <CalendarDays
                  className="h-4 w-4 shrink-0 text-fdnda-turquoise-deep"
                  aria-hidden="true"
                />
                {formatDateOnly(nextEvent.startDate)} – {formatDateOnly(nextEvent.endDate)}
              </p>
              {nextEvent.venue ? (
                <p className="flex items-center gap-2 text-sm text-fdnda-muted">
                  <MapPin
                    className="h-4 w-4 shrink-0 text-fdnda-turquoise-deep"
                    aria-hidden="true"
                  />
                  {[nextEvent.venue, nextEvent.city].filter(Boolean).join(", ")}
                </p>
              ) : null}
              <p className="flex items-center gap-2 text-sm font-semibold text-fdnda-ink">
                <Clock3 className="h-4 w-4 shrink-0 text-fdnda-warning" aria-hidden="true" />
                Inscripción hasta el {formatDateTimeLima(nextEvent.registrationDeadline)}
              </p>
              <p className="text-sm text-fdnda-muted">
                {plural(nextEvent._count.modalities, "prueba", "pruebas")}
              </p>
            </div>
            {readyToEnter ? (
              <Link
                href={`/inscripciones/nueva?evento=${encodeURIComponent(nextEvent.slug)}`}
                className={buttonClasses({ variant: "outline" })}
              >
                Armar planilla
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <p className="max-w-56 text-sm text-fdnda-muted">
                Para inscribir necesitas tu club y tus deportistas afiliados.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

// Los cuatro pasos se dibujan como andariveles de una piscina: un carril por
// tarea, con la franja superior en navy si ya está hecho, en turquesa si es el
// que toca y apagada si todavía no. Debajo, solo el paso actual con su acción.
function FirstSteps({ steps, seasonOpen }: { steps: FirstStep[]; seasonOpen: boolean }) {
  const doneCount = steps.filter((step) => step.status === "done").length
  const current = steps.find((step) => step.status === "current")

  return (
    <section
      aria-labelledby="primeros-pasos"
      className="overflow-hidden rounded-panel border border-fdnda-border bg-white shadow-floating"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div>
          <h2 id="primeros-pasos" className="font-heading text-2xl text-fdnda-navy">
            Primeros pasos
          </h2>
          <p className="mt-0.5 text-sm text-fdnda-muted">
            {doneCount} de {steps.length} listos · se marcan solos a medida que avanzas
          </p>
        </div>
        <GuideLauncher tone="page" />
      </div>

      <ol className="grid grid-cols-2 gap-px border-y border-fdnda-border bg-fdnda-border lg:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.title}
            aria-current={step.status === "current" ? "step" : undefined}
            className={cn(
              "relative bg-white px-4 pb-4 pt-5",
              step.status === "current" && "bg-fdnda-sky-soft"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-0 top-0 h-lane-strong",
                step.status === "done" && "bg-fdnda-navy",
                step.status === "current" && "bg-fdnda-turquoise",
                step.status === "upcoming" && "bg-fdnda-border",
                step.status === "blocked" && "bg-fdnda-warning-ring"
              )}
            />
            <div className="flex items-center gap-2">
              {step.status === "done" ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-fdnda-success" aria-hidden="true" />
              ) : step.status === "blocked" ? (
                <Clock3 className="h-5 w-5 shrink-0 text-fdnda-warning" aria-hidden="true" />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "num flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold",
                    step.status === "current"
                      ? "bg-fdnda-turquoise-deep text-white"
                      : "bg-fdnda-surface text-fdnda-muted ring-1 ring-inset ring-fdnda-border"
                  )}
                >
                  {index + 1}
                </span>
              )}
              <span className="sr-only">
                {step.status === "done"
                  ? "Hecho:"
                  : step.status === "current"
                    ? "Paso actual:"
                    : step.status === "blocked"
                      ? "En espera:"
                      : "Pendiente:"}
              </span>
              <p
                className={cn(
                  "text-sm font-bold leading-5",
                  step.status === "upcoming" ? "text-fdnda-muted" : "text-fdnda-ink"
                )}
              >
                {step.title}
              </p>
            </div>
            <p className="mt-1.5 pl-7 text-xs leading-5 text-fdnda-muted">{step.summary}</p>
          </li>
        ))}
      </ol>

      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div className="min-w-0 max-w-2xl">
            <p className="font-heading text-lg font-bold text-fdnda-navy">{current.title}</p>
            <p className="mt-1 text-sm leading-6 text-fdnda-ink">{current.detail}</p>
          </div>
          {current.cta ? (
            <Link href={current.cta.href} className={buttonClasses({ size: "lg" })}>
              {current.cta.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="px-5 py-5 text-sm leading-6 text-fdnda-ink">
          {seasonOpen
            ? "Tu próximo paso depende de la FDNDA: cuando fije las cuotas o abra una competencia de tus disciplinas, lo verás aquí."
            : "La FDNDA aún no abre la temporada de afiliaciones. Cuando la abra, aquí verás qué sigue."}
        </p>
      )}
    </section>
  )
}

function SeasonNotice({ notice }: { notice: Notice }) {
  const style = NOTICE_STYLE[notice.tone]
  const Icon = style.icon
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-panel border px-5 py-4 shadow-raised",
        style.box
      )}
    >
      <p className="flex min-w-0 max-w-3xl items-start gap-2.5 text-sm font-semibold leading-6">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        {notice.message}
      </p>
      {notice.cta ? (
        <Link href={notice.cta.href} className={buttonClasses({ size: "lg" })}>
          {notice.cta.label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  )
}
