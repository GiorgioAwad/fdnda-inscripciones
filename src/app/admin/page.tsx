import Link from "next/link"
import {
  ArrowRight,
  CalendarDays,
  CalendarX2,
  LayoutDashboard,
  Receipt,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getFederationOverview } from "@/lib/affiliations"
import { expireStaleOrders } from "@/lib/orders"
import { formatMoney } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge, EVENT_STATUS_BADGE } from "@/components/ui/badge"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"

export const dynamic = "force-dynamic"

export default async function AdminDashboardPage() {
  await expireStaleOrders()

  const [openEvents, clubCount, athleteCount, paidAggregate, recentEvents, affiliations] =
    await Promise.all([
      prisma.event.count({ where: { status: "OPEN" } }),
      prisma.club.count({ where: { isActive: true } }),
      prisma.athlete.count({ where: { isActive: true } }),
      prisma.order.aggregate({
        where: { status: "PAID" },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.event.findMany({
        orderBy: { startDate: "desc" },
        take: 5,
        include: {
          _count: { select: { modalities: true } },
        },
      }),
      getFederationOverview(),
    ])

  return (
    <div className="space-y-7">
      <PageHeader
        icon={LayoutDashboard}
        eyebrow={
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-fdnda-turquoise-deep">
            Administración
          </p>
        }
        title="Resumen"
        description="Estado general de la plataforma de inscripciones."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Eventos abiertos"
          value={String(openEvents)}
          icon={CalendarDays}
          tone="turquoise"
          href="/admin/eventos"
        />
        <StatCard
          label="Clubes activos"
          value={String(clubCount)}
          icon={UsersRound}
          tone="sky"
          href="/admin/clubes"
        />
        <StatCard
          label="Deportistas"
          value={String(athleteCount)}
          icon={Users}
          tone="navy"
          href="/admin/padron"
        />
        {/* La etiqueta decía «Clubes afiliados» y el valor dividía pares
            (club, disciplina) entre número de clubes: con 11 clubes y tres
            disciplinas salía «30/11». Con cuota por disciplina la unidad es la
            cuota, no el club —un club puede estar al día en polo y deber
            clavados—, así que ahora numerador y denominador cuentan lo mismo y
            la etiqueta lo dice. Es el mismo nombre que ya usa el panel de
            afiliaciones. */}
        <StatCard
          label={
            affiliations.season
              ? `Cuotas de club vigentes ${affiliations.season.year}`
              : "Sin temporada vigente"
          }
          value={
            affiliations.totals
              ? `${affiliations.totals.clubsAffiliated}/${affiliations.totals.clubDisciplinesTotal}`
              : "—"
          }
          icon={ShieldCheck}
          tone="sky"
          href="/admin/afiliaciones"
        />
        <StatCard
          label={`Recaudado (${paidAggregate._count} órdenes)`}
          value={formatMoney(paidAggregate._sum.totalAmount ?? 0)}
          icon={Receipt}
          tone="turquoise"
          href="/admin/ordenes"
        />
      </div>

      <Card className="animate-fade-up overflow-hidden">
        <CardHeader className="border-b border-fdnda-border bg-fdnda-navy py-4">
          <CardTitle className="text-white">Eventos recientes</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-fdnda-border p-0">
          {recentEvents.length === 0 ? (
            <EmptyState icon={CalendarX2} title="Aún no hay eventos">
              <Link href="/admin/eventos" className="inline-flex min-h-11 items-center font-bold text-fdnda-navy underline">
                Crea el primero
              </Link>
            </EmptyState>
          ) : (
            recentEvents.map((event) => {
              const badge = EVENT_STATUS_BADGE[event.status]
              return (
                <Link
                  key={event.id}
                  href={`/admin/eventos/${event.id}`}
                  className="group flex min-h-16 flex-wrap items-center justify-between gap-2 px-5 py-3.5 transition-colors hover:bg-fdnda-sky-soft"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-fdnda-ink group-hover:text-fdnda-navy">
                      {event.name}
                    </p>
                    <p className="text-xs text-fdnda-muted">
                      {event._count.modalities} pruebas
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <ArrowRight className="h-4 w-4 text-fdnda-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fdnda-turquoise-deep" aria-hidden="true" />
                  </div>
                </Link>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
