import Link from "next/link"
import { redirect } from "next/navigation"
import { Clock3, Users } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import {
  affiliationState,
  athleteDisciplines,
  getCurrentSeason,
  getSeasonCategories,
  isSettledState,
} from "@/lib/affiliations"
import { categoryLabelFor } from "@/lib/categories"
import {
  DISCIPLINES,
  DISCIPLINE_VALUES,
  isDiscipline,
  type DisciplineValue,
} from "@/lib/disciplines"
import { prisma } from "@/lib/prisma"
import { cn, formatDateOnly, SEX_LABELS } from "@/lib/utils"
import { AFFILIATION_STATE_BADGE, Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { EmptyState } from "@/components/empty-state"
import { AddAthleteDialog } from "./add-athlete-dialog"
import { canAccessDiscipline, isClubCoordinator } from "@/lib/club-access"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

// Esta página es SOLO el padrón del club. Afiliar (y su historial) vive en
// /afiliacion; antes estaban acá como pestañas y partían la tarea en dos.
export default async function DeportistasPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; disciplina?: string; page?: string }>
}) {
  const { tab, disciplina, page } = await searchParams

  // Los enlaces viejos siguen funcionando.
  if (tab === "por-afiliar") redirect("/afiliacion?tab=deportistas")
  if (tab === "historial") redirect("/afiliacion?tab=historial")

  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin/padron")
  const clubId = user.clubId

  const availableDisciplines = isClubCoordinator(user)
    ? [...DISCIPLINE_VALUES]
    : DISCIPLINE_VALUES.filter((value) => canAccessDiscipline(user, value))
  const filter: DisciplineValue | null =
    isDiscipline(disciplina) && canAccessDiscipline(user, disciplina)
      ? disciplina
      : availableDisciplines.length === 1
        ? availableDisciplines[0]
        : null
  const requestedPage = Math.max(1, Math.trunc(Number(page) || 1))
  const season = await getCurrentSeason()
  const where = {
    clubId,
    isActive: true,
    ...(filter ? { disciplines: { has: filter } } : {}),
  }
  const [total, allTotal, disciplineCounts, categories] = await Promise.all([
    prisma.athlete.count({ where }),
    prisma.athlete.count({
      where: {
        clubId,
        isActive: true,
        ...(isClubCoordinator(user)
          ? {}
          : { disciplines: { hasSome: [...user.disciplineAccess] } }),
      },
    }),
    Promise.all(
      availableDisciplines.map(async (discipline) => ({
        discipline,
        count: await prisma.athlete.count({
          where: { clubId, isActive: true, disciplines: { has: discipline } },
        }),
      }))
    ),
    season ? getSeasonCategories(season.id) : Promise.resolve([]),
  ])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)
  const athletes = await prisma.athlete.findMany({
    where,
    orderBy: [{ lastNames: "asc" }, { firstNames: "asc" }, { id: "asc" }],
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      affiliations: season ? { where: { seasonId: season.id } } : { take: 0 },
    },
  })

  const filters = [
    { value: null, label: "Todas", count: allTotal },
    ...disciplineCounts
      .filter((row) => row.count > 0)
      .map((row) => ({
        value: row.discipline,
        label: DISCIPLINES[row.discipline].label,
        count: row.count,
      })),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        eyebrow="Afiliación"
        title="Deportistas"
        description={`${allTotal} deportista(s) en el padrón de tu club. La afiliación anual se gestiona en «Estado de afiliación».`}
        actions={<AddAthleteDialog disciplineAccess={availableDisciplines} />}
      />

      {filters.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por disciplina">
          {filters.map((item) => {
            const active = filter === item.value
            return (
              <Link
                key={item.value ?? "all"}
                href={item.value ? `/deportistas?disciplina=${item.value}` : "/deportistas"}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors",
                  active
                    ? "bg-fdnda-navy text-white ring-fdnda-navy"
                    : "bg-white text-fdnda-muted ring-fdnda-border hover:text-fdnda-navy"
                )}
              >
                {item.label}
                <span className="num text-xs opacity-70">{item.count}</span>
              </Link>
            )
          })}
        </div>
      ) : null}

      {!season ? (
        <Card>
          <EmptyState icon={Clock3} title="Temporada no habilitada">
            La federación todavía no abrió la temporada de afiliaciones. Puedes
            registrar deportistas; su afiliación se generará al abrirse.
          </EmptyState>
        </Card>
      ) : null}

      {athletes.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No hay deportistas para mostrar">
            {filter
              ? "Ningún deportista de tu club practica esta disciplina."
              : "Usa «Agregar deportista» para registrarlos."}
          </EmptyState>
        </Card>
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH className="w-12">N°</TH>
                <TH>Deportista</TH>
                <TH>F. nacimiento</TH>
                <TH>Documento</TH>
                <TH>Sexo</TH>
                <TH>Categoría</TH>
                <TH>Afiliación por disciplina</TH>
              </TR>
            </THead>
            <TBody>
              {athletes.map((row, index) => {
                const disciplines = athleteDisciplines(row.disciplines)
                return (
                  <TR key={row.id}>
                    <TD className="num text-xs text-fdnda-muted">
                      {(currentPage - 1) * PAGE_SIZE + index + 1}
                    </TD>
                    <TD className="font-bold text-fdnda-ink">
                      {row.lastNames}, {row.firstNames}
                    </TD>
                    <TD className="text-xs">{formatDateOnly(row.birthDate)}</TD>
                    <TD className="num text-xs">
                      {row.docType} {row.docNumber}
                    </TD>
                    <TD className="text-xs">{SEX_LABELS[row.sex]}</TD>
                    <TD className="text-xs">
                      {categoryLabelFor(categories, row.birthDate, filter ?? undefined)}
                    </TD>
                    <TD>
                      {disciplines.length === 0 ? (
                        <span className="text-xs text-fdnda-muted">
                          Sin disciplinas registradas
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {disciplines.map((discipline) => {
                            const affiliation = row.affiliations.find(
                              (entry) => entry.discipline === discipline
                            )
                            const state = affiliationState(affiliation)
                            const badge =
                              AFFILIATION_STATE_BADGE[state] ??
                              AFFILIATION_STATE_BADGE.SIN_AFILIAR
                            const settled = isSettledState(state)
                            const short = DISCIPLINES[discipline].short

                            // Lo no regularizado enlaza directo a donde se arregla.
                            return settled ? (
                              <Badge key={discipline} variant={badge.variant}>
                                {short} · {badge.label}
                              </Badge>
                            ) : (
                              <Link
                                key={discipline}
                                href="/afiliacion?tab=deportistas"
                                className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise"
                                title={`Afiliar ${short}`}
                              >
                                <Badge variant={badge.variant}>
                                  {short} · {badge.label}
                                </Badge>
                              </Link>
                            )
                          })}
                        </div>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </TableContainer>
      )}
      <Pagination
        pathname="/deportistas"
        currentPage={currentPage}
        totalPages={totalPages}
        query={{ disciplina: filter }}
      />
    </div>
  )
}
