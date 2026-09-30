import Link from "next/link"
import {
  ArrowRight,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  KeyRound,
  ReceiptText,
} from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getFederationOverview } from "@/lib/affiliations"
import { countOrdersRequiringPaymentReview, expireStaleOrders } from "@/lib/orders"
import { cn, formatDateTimeLima, formatMoney, plural } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import {
  Badge,
  EVENT_DEADLINE_PASSED_BADGE,
  EVENT_STATUS_BADGE,
} from "@/components/ui/badge"
import { buttonClasses } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { GuideLauncher } from "@/components/onboarding/guide"

export const dynamic = "force-dynamic"

type Cta = { href: string; label: string }

interface SetupStep {
  title: string
  done: boolean
  summary: string
  detail: string
  cta: Cta
}

interface Attention {
  icon: typeof ReceiptText
  title: string
  detail: string
  cta: Cta
}

// El inicio del admin responde dos preguntas, en este orden: ¿falta algo para
// que los clubes puedan operar esta temporada? y ¿qué necesita mi atención hoy?
// Antes eran cinco tarjetas de cifras que no pedían ninguna acción: las cifras
// siguen, pero abajo y en una sola franja.
export default async function AdminHomePage() {
  await expireStaleOrders()
  const now = new Date()

  const [overview, seasonsCount, activeClubs, clubsWithoutUser, athleteCount] =
    await Promise.all([
      getFederationOverview(),
      prisma.season.count(),
      prisma.club.count({ where: { isActive: true } }),
      prisma.club.count({
        where: { isActive: true, users: { none: { isActive: true } } },
      }),
      prisma.athlete.count({ where: { isActive: true } }),
    ])
  const season = overview.season

  const [
    seasonFees,
    publishedEvents,
    draftEvents,
    openPastDeadline,
    ordersToReconcile,
    paidAggregate,
    recentEvents,
  ] = await Promise.all([
    season ? prisma.seasonFee.count({ where: { seasonId: season.id } }) : 0,
    prisma.event.count({ where: { status: { not: "DRAFT" } } }),
    prisma.event.count({ where: { status: "DRAFT" } }),
    prisma.event.count({
      where: { status: "OPEN", registrationDeadline: { lt: now } },
    }),
    countOrdersRequiringPaymentReview(),
    prisma.order.aggregate({
      where: { status: "PAID" },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.event.findMany({
      orderBy: { startDate: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        registrationDeadline: true,
        _count: { select: { modalities: true } },
      },
    }),
  ])

  // ---- Puesta en marcha: cuatro condiciones para que un club pueda competir.
  const setup: SetupStep[] = [
    season && seasonFees > 0
      ? {
          title: "Abre la temporada",
          done: true,
          summary: `${season.name} vigente`,
          detail: "",
          cta: { href: "/admin/temporadas", label: "" },
        }
      : season
        ? {
            title: "Abre la temporada",
            done: false,
            summary: "Sin cuotas fijadas",
            detail: `La ${season.name.toLowerCase()} no tiene cuotas de afiliación: sin ellas ningún club puede afiliarse.`,
            cta: { href: "/admin/temporadas", label: `Fijar cuotas de ${season.name}` },
          }
        : seasonsCount > 0
          ? {
              title: "Abre la temporada",
              done: false,
              summary: "Ninguna vigente",
              detail:
                "Hay temporadas creadas, pero ninguna vigente. Hasta que una lo sea, los clubes no pueden afiliarse ni inscribir.",
              cta: { href: "/admin/temporadas", label: "Hacer vigente una temporada" },
            }
          : {
              title: "Abre la temporada",
              done: false,
              summary: "Sin temporadas",
              detail:
                "Crea la temporada con su vigencia y la cuota de afiliación del club y por deportista de cada disciplina.",
              cta: { href: "/admin/temporadas", label: "Crear temporada" },
            },
    activeClubs === 0
      ? {
          title: "Da acceso a los clubes",
          done: false,
          summary: "Sin clubes",
          detail:
            "Registra cada club y crea su usuario de acceso: coordinador del club o delegado de una disciplina.",
          cta: { href: "/admin/clubes", label: "Registrar el primer club" },
        }
      : clubsWithoutUser > 0
        ? {
            title: "Da acceso a los clubes",
            done: false,
            summary: `${plural(clubsWithoutUser, "club", "clubes")} sin usuario`,
            detail: `${plural(clubsWithoutUser, "club habilitado no tiene", "clubes habilitados no tienen")} usuario de acceso, así que no pueden entrar al portal.`,
            cta: { href: "/admin/clubes", label: "Crear usuarios de acceso" },
          }
        : {
            title: "Da acceso a los clubes",
            done: true,
            summary: plural(activeClubs, "club con acceso", "clubes con acceso"),
            detail: "",
            cta: { href: "/admin/clubes", label: "" },
          },
    athleteCount > 0
      ? {
          title: "Carga el padrón",
          done: true,
          summary: plural(athleteCount, "deportista", "deportistas"),
          detail: "",
          cta: { href: "/admin/padron", label: "" },
        }
      : {
          title: "Carga el padrón",
          done: false,
          summary: "Padrón vacío",
          detail:
            "Importa el Excel con los deportistas de cada club, o deja que cada club los registre desde su portal.",
          cta: { href: "/admin/padron/importar", label: "Importar padrón" },
        },
    publishedEvents > 0
      ? {
          title: "Publica una competencia",
          done: true,
          summary: plural(publishedEvents, "competencia publicada", "competencias publicadas"),
          detail: "",
          cta: { href: "/admin/eventos", label: "" },
        }
      : draftEvents > 0
        ? {
            title: "Publica una competencia",
            done: false,
            summary: plural(draftEvents, "borrador", "borradores"),
            detail: `Tienes ${plural(draftEvents, "competencia en borrador", "competencias en borrador")}: los clubes todavía no la ven. Revisa sus pruebas y abre las inscripciones cuando cumpla los requisitos.`,
            cta: { href: "/admin/eventos", label: "Revisar borradores" },
          }
        : {
            title: "Publica una competencia",
            done: false,
            summary: "Sin competencias",
            detail:
              "Crea la competencia: al elegir la disciplina, el formulario propone sus pruebas y la forma de cobro.",
            cta: { href: "/admin/eventos", label: "Crear competencia" },
          },
  ]
  const setupComplete = setup.every((step) => step.done)
  const currentSetup = setup.find((step) => !step.done)

  // ---- Por atender: solo lo que hoy pide una acción.
  const attention: Attention[] = []
  if (ordersToReconcile > 0) {
    attention.push({
      icon: ReceiptText,
      title: plural(ordersToReconcile, "orden por conciliar", "órdenes por conciliar"),
      detail:
        "Vencieron con un pago abierto en Izipay. Compruébalas en Izipay antes de pedirle al club que pague de nuevo.",
      cta: { href: "/admin/ordenes?review=1", label: "Revisar órdenes por conciliar" },
    })
  }
  if (openPastDeadline > 0) {
    attention.push({
      icon: CalendarClock,
      title: plural(
        openPastDeadline,
        "competencia con el plazo vencido",
        "competencias con el plazo vencido"
      ),
      detail:
        "Siguen marcadas como abiertas, pero los clubes ya no las ven. Ciérralas para que su estado coincida.",
      cta: { href: "/admin/eventos", label: "Cerrar inscripciones vencidas" },
    })
  }
  if (setupComplete && clubsWithoutUser > 0) {
    attention.push({
      icon: KeyRound,
      title: plural(clubsWithoutUser, "club sin usuario de acceso", "clubes sin usuario de acceso"),
      detail: "No pueden entrar al portal hasta que les crees un usuario.",
      cta: { href: "/admin/clubes", label: "Crear usuarios de acceso" },
    })
  }

  const figures: { label: string; value: string; href: string }[] = [
    { label: "Clubes habilitados", value: String(activeClubs), href: "/admin/clubes" },
    { label: "Deportistas en el padrón", value: String(athleteCount), href: "/admin/padron" },
    {
      label: season ? `Cuotas de club vigentes ${season.year}` : "Cuotas de club vigentes",
      value: overview.totals ? String(overview.totals.clubsAffiliated) : "—",
      href: "/admin/afiliaciones",
    },
    {
      label: `Cobrado en ${plural(paidAggregate._count, "orden", "órdenes")}`,
      value: formatMoney(paidAggregate._sum.totalAmount ?? 0),
      href: "/admin/ordenes",
    },
  ]

  return (
    <div className="space-y-7">
      <PageHeader
        title={season ? season.name : "Sin temporada vigente"}
        description={
          attention.length > 0
            ? attention.map((item) => item.title).join(" · ")
            : setupComplete
              ? "Nada pendiente de revisión."
              : "Completa la puesta en marcha para que los clubes puedan afiliarse e inscribir."
        }
      />

      {!setupComplete ? (
        <section
          aria-labelledby="puesta-en-marcha"
          className="overflow-hidden rounded-panel border border-fdnda-border bg-white shadow-floating"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
            <div>
              <h2 id="puesta-en-marcha" className="font-heading text-2xl text-fdnda-navy">
                Puesta en marcha
              </h2>
              <p className="mt-0.5 text-sm text-fdnda-muted">
                {setup.filter((step) => step.done).length} de {setup.length} listos · se
                marcan solos con los datos de la plataforma
              </p>
            </div>
            <GuideLauncher tone="page" />
          </div>
          <ol className="grid grid-cols-2 gap-px border-y border-fdnda-border bg-fdnda-border lg:grid-cols-4">
            {setup.map((step, index) => {
              const current = step === currentSetup
              return (
                <li
                  key={step.title}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "relative bg-white px-4 pb-4 pt-5",
                    current && "bg-fdnda-sky-soft"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-x-0 top-0 h-lane-strong",
                      step.done
                        ? "bg-fdnda-navy"
                        : current
                          ? "bg-fdnda-turquoise"
                          : "bg-fdnda-border"
                    )}
                  />
                  <div className="flex items-center gap-2">
                    {step.done ? (
                      <CheckCircle2
                        className="h-5 w-5 shrink-0 text-fdnda-success"
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "num flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold",
                          current
                            ? "bg-fdnda-turquoise-deep text-white"
                            : "bg-fdnda-surface text-fdnda-muted ring-1 ring-inset ring-fdnda-border"
                        )}
                      >
                        {index + 1}
                      </span>
                    )}
                    <span className="sr-only">
                      {step.done ? "Hecho:" : current ? "Paso actual:" : "Pendiente:"}
                    </span>
                    <p className="text-sm font-bold leading-5 text-fdnda-ink">{step.title}</p>
                  </div>
                  <p className="mt-1.5 pl-7 text-xs leading-5 text-fdnda-muted">
                    {step.summary}
                  </p>
                </li>
              )
            })}
          </ol>
          {currentSetup ? (
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
              <div className="min-w-0 max-w-2xl">
                <p className="font-heading text-lg font-bold text-fdnda-navy">
                  {currentSetup.title}
                </p>
                <p className="mt-1 text-sm leading-6 text-fdnda-ink">{currentSetup.detail}</p>
              </div>
              <Link href={currentSetup.cta.href} className={buttonClasses({ size: "lg" })}>
                {currentSetup.cta.label}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      {attention.length > 0 ? (
        <section aria-labelledby="por-atender">
          <h2 id="por-atender" className="font-heading text-xl font-bold text-fdnda-navy">
            Por atender
          </h2>
          <ul className="mt-3 divide-y divide-fdnda-border overflow-hidden rounded-surface border border-fdnda-warning-ring bg-white shadow-raised">
            {attention.map((item) => {
              const Icon = item.icon
              return (
                <li
                  key={item.title}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="flex min-w-0 max-w-2xl items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-chip bg-fdnda-warning-soft text-fdnda-warning ring-1 ring-inset ring-fdnda-warning-ring"
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <div>
                      <p className="font-bold text-fdnda-ink">{item.title}</p>
                      <p className="text-sm leading-6 text-fdnda-muted">{item.detail}</p>
                    </div>
                  </div>
                  <Link href={item.cta.href} className={buttonClasses({ variant: "outline" })}>
                    {item.cta.label}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {/* Cifras en una sola franja y cada una lleva a su pantalla. Antes eran
          cinco tarjetas de número grande que competían con lo accionable. */}
      <section aria-labelledby="cifras">
        <h2 id="cifras" className="sr-only">
          Cifras de la plataforma
        </h2>
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-surface border border-fdnda-border bg-fdnda-border shadow-raised lg:grid-cols-4">
          {figures.map((figure) => (
            <li key={figure.label} className="bg-white">
              <Link
                href={figure.href}
                className="flex h-full flex-col gap-1 px-5 py-4 transition-colors hover:bg-fdnda-sky-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fdnda-turquoise"
              >
                <span className="num text-2xl font-bold text-fdnda-navy">{figure.value}</span>
                <span className="text-xs font-semibold text-fdnda-muted">{figure.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fdnda-border bg-fdnda-navy px-5 py-4">
          <h2 className="font-heading text-lg font-bold text-white">Competencias recientes</h2>
          <Link
            href="/admin/eventos"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-white underline-offset-4 hover:underline"
          >
            Todas las competencias
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        {recentEvents.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title="Todavía no hay competencias"
            action={
              <Link href="/admin/eventos" className={buttonClasses({ variant: "outline" })}>
                Crear la primera competencia
              </Link>
            }
          >
            Al elegir la disciplina, el formulario propone sus pruebas y la forma de
            cobro.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-fdnda-border">
            {recentEvents.map((event) => {
              const badge =
                event.status === "OPEN" && event.registrationDeadline < now
                  ? EVENT_DEADLINE_PASSED_BADGE
                  : EVENT_STATUS_BADGE[event.status]
              return (
                <li key={event.id}>
                  <Link
                    href={`/admin/eventos/${event.id}`}
                    className="group flex min-h-16 flex-wrap items-center justify-between gap-2 px-5 py-3.5 transition-colors hover:bg-fdnda-sky-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fdnda-turquoise"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-fdnda-ink group-hover:text-fdnda-navy">
                        {event.name}
                      </p>
                      <p className="text-xs text-fdnda-muted">
                        {plural(event._count.modalities, "prueba", "pruebas")} · cierre{" "}
                        {formatDateTimeLima(event.registrationDeadline)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      <ArrowRight
                        className="h-4 w-4 text-fdnda-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fdnda-turquoise-deep motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
