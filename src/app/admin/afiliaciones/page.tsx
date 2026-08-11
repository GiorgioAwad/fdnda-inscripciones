import Link from "next/link"
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  FileSpreadsheet,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react"
import { getFederationOverview } from "@/lib/affiliations"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { ClubsAffiliationTable } from "./clubs-affiliation-table"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 20

export default async function AfiliacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const requestedPage = Math.max(1, Math.trunc(Number((await searchParams).page) || 1))
  const { season, clubs, totals } = await getFederationOverview()

  if (!season || !totals) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={ShieldCheck}
          eyebrow="Afiliaciones"
          title="Panel de la federación"
        />
        <Card>
          <EmptyState icon={CalendarClock} title="No hay temporada vigente">
            <p>
              Crea una temporada y márcala como vigente para habilitar las
              afiliaciones y las inscripciones.
            </p>
            <Link href="/admin/temporadas" className="mt-4 inline-block">
              <Button>Ir a temporadas</Button>
            </Link>
          </EmptyState>
        </Card>
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(clubs.length / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)
  const visibleClubs = clubs.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Afiliaciones"
        title="Panel de la federación"
        description={`Control de vigencias de la ${season.name.toLowerCase()}, por club y disciplina.`}
        actions={
          <a href="/api/admin/afiliaciones/export" download>
            <Button variant="outline">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Exportar Excel
            </Button>
          </a>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Cuotas de club vigentes"
          value={String(totals.clubsAffiliated)}
          icon={BadgeCheck}
          tone="turquoise"
        />
        <StatCard
          label="Cuotas de club por regularizar"
          value={String(totals.clubsPending + totals.clubsUnaffiliated)}
          icon={UsersRound}
          tone="warning"
        />
        <StatCard
          label="Afiliaciones de deportistas"
          value={String(totals.athletesAffiliated)}
          icon={Users}
          tone="navy"
        />
        <StatCard
          label="Por vencer (30 días)"
          value={String(totals.expiringSoon)}
          icon={CalendarClock}
          tone="sky"
        />
        <StatCard
          label="Afiliaciones sin vigencia"
          value={String(totals.athletesUnaffiliated + totals.athletesPending)}
          icon={AlertTriangle}
          tone="warning"
        />
      </div>

      {clubs.length === 0 ? (
        <Card>
          <EmptyState icon={UsersRound} title="Aún no hay clubes">
            <Link href="/admin/clubes" className="font-bold text-fdnda-navy underline">
              Registra el primero
            </Link>
          </EmptyState>
        </Card>
      ) : (
        <ClubsAffiliationTable
          rows={visibleClubs.map((club) => ({
            clubId: club.clubId,
            clubName: club.clubName,
            clubCode: club.clubCode,
            athletesTotal: club.athletesTotal,
            disciplines: club.disciplines.map((row) => ({
              discipline: row.discipline,
              affiliationId: row.affiliationId,
              clubState: row.clubState,
              fee: row.fee,
              validToISO: row.validTo ? row.validTo.toISOString() : null,
              athletesTotal: row.athletesTotal,
              athletesActive: row.athletesActive,
              athletesPending: row.athletesPending,
              athletesExpiredOrMissing: row.athletesExpiredOrMissing,
            })),
          }))}
        />
      )}
      <Pagination
        pathname="/admin/afiliaciones"
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </div>
  )
}
