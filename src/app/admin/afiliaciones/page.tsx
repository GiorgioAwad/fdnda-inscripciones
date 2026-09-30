import Link from "next/link"
import { CalendarClock, FileSpreadsheet, ShieldCheck, UsersRound } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getFederationOverview, getSeasonFees } from "@/lib/affiliations"
import { plural } from "@/lib/utils"
import { buttonClasses } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { EmptyState } from "@/components/empty-state"
import { ClubsAffiliationTable, type ExternalPayment } from "./clubs-affiliation-table"

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
        <PageHeader icon={ShieldCheck} title="Afiliaciones" />
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="No hay temporada vigente"
            action={
              <Link href="/admin/temporadas" className={buttonClasses()}>
                Definir la temporada y sus cuotas
              </Link>
            }
          >
            Sin temporada vigente los clubes no pueden afiliarse. Crea una temporada con
            sus cuotas de afiliación y hazla vigente.
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

  // Afiliaciones pendientes que ya están en una orden por pagar del club: si la
  // federación registra el pago por fuera y el club paga después esa orden, el
  // club pagaría dos veces. El diálogo lo avisa con el código de la orden.
  const [fees, inOrder] = await Promise.all([
    getSeasonFees(season.id),
    prisma.clubAffiliation.findMany({
      where: { seasonId: season.id, status: "PENDING", activeOrderId: { not: null } },
      select: { id: true, activeOrderId: true },
    }),
  ])
  const orders = inOrder.length
    ? await prisma.order.findMany({
        where: {
          id: { in: inOrder.map((row) => row.activeOrderId!) },
          status: "PENDING",
        },
        select: { id: true, code: true },
      })
    : []
  const orderCodeById = new Map(orders.map((order) => [order.id, order.code]))
  const orderCodeByAffiliation = new Map(
    inOrder.map((row) => [row.id, orderCodeById.get(row.activeOrderId!) ?? null])
  )

  // Los totales cuentan pares (club, disciplina); «por vencer» mezclaba esos
  // pares con afiliaciones de deportistas en una sola cifra. Se separan aquí con
  // la misma fórmula de getFederationOverview.
  const clubRows = clubs.flatMap((club) => club.disciplines)
  const clubExpiring = clubRows.filter((row) => row.clubState === "POR_VENCER").length
  const athletesExpiring = totals.expiringSoon - clubExpiring

  const paymentFor = (
    row: (typeof clubRows)[number]
  ): ExternalPayment | null => {
    if (row.clubState === "PENDIENTE" && row.affiliationId && row.fee !== null && row.validTo) {
      return {
        fee: row.fee,
        validToISO: row.validTo.toISOString(),
        orderCode: orderCodeByAffiliation.get(row.affiliationId) ?? null,
      }
    }
    if (row.clubState === "SIN_AFILIAR") {
      const fee = fees.get(row.discipline)
      return fee
        ? { fee: fee.clubFee, validToISO: season.endDate.toISOString(), orderCode: null }
        : null
    }
    return null
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title={`Afiliaciones ${season.year}`}
        description="Cuota de afiliación de cada club por disciplina y cuántos de sus deportistas tienen la afiliación vigente para competir."
        actions={
          <a
            href="/api/admin/afiliaciones/export"
            download
            className={buttonClasses({ variant: "outline" })}
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Descargar
            afiliaciones {season.year} (Excel)
          </a>
        }
      />

      <Card className="p-5">
        <dl className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold text-fdnda-navy">
              Cuotas de afiliación de club (una por club y disciplina)
            </dt>
            <dd className="mt-1 leading-6 text-fdnda-ink">
              {plural(totals.clubsAffiliated, "vigente", "vigentes")}
              {clubExpiring > 0 ? ` (${clubExpiring} por vencer en 30 días)` : ""} ·{" "}
              <span className={totals.clubsPending > 0 ? "font-semibold text-fdnda-warning" : ""}>
                {plural(totals.clubsPending, "pendiente de pago", "pendientes de pago")}
              </span>{" "}
              ·{" "}
              <span
                className={totals.clubsUnaffiliated > 0 ? "font-semibold text-fdnda-danger" : ""}
              >
                {plural(totals.clubsUnaffiliated, "vencida o sin afiliar", "vencidas o sin afiliar")}
              </span>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-fdnda-navy">
              Afiliaciones de deportistas (una por deportista y disciplina)
            </dt>
            <dd className="mt-1 leading-6 text-fdnda-ink">
              {plural(totals.athletesAffiliated, "vigente", "vigentes")}
              {athletesExpiring > 0 ? ` (${athletesExpiring} por vencer en 30 días)` : ""} ·{" "}
              <span
                className={totals.athletesPending > 0 ? "font-semibold text-fdnda-warning" : ""}
              >
                {plural(totals.athletesPending, "pendiente de pago", "pendientes de pago")}
              </span>{" "}
              ·{" "}
              <span
                className={
                  totals.athletesUnaffiliated > 0 ? "font-semibold text-fdnda-danger" : ""
                }
              >
                {plural(
                  totals.athletesUnaffiliated,
                  "vencida o sin afiliar",
                  "vencidas o sin afiliar"
                )}
              </span>
            </dd>
          </div>
        </dl>
      </Card>

      {clubs.length === 0 ? (
        <Card>
          <EmptyState
            icon={UsersRound}
            title="Aún no hay clubes"
            action={
              <Link href="/admin/clubes" className={buttonClasses()}>
                Registrar el primer club
              </Link>
            }
          >
            Cuando registres clubes, aquí verás su cuota de afiliación por disciplina y
            cuántos de sus deportistas están afiliados.
          </EmptyState>
        </Card>
      ) : (
        <ClubsAffiliationTable
          seasonName={season.name}
          rows={visibleClubs.map((club) => ({
            clubId: club.clubId,
            clubName: club.clubName,
            clubCode: club.clubCode,
            isActive: club.isActive,
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
              payment: paymentFor(row),
            })),
          }))}
        />
      )}
      <Pagination
        pathname="/admin/afiliaciones"
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        totalItems={clubs.length}
      />
    </div>
  )
}
