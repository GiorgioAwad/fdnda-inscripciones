import Link from "next/link"
import { FileSpreadsheet, Upload, Users } from "lucide-react"
import { prisma } from "@/lib/prisma"
import {
  affiliationState,
  athleteDisciplines,
  getCurrentSeason,
  getSeasonCategories,
} from "@/lib/affiliations"
import { categoryLabelFor } from "@/lib/categories"
import { plural } from "@/lib/utils"
import { buttonClasses } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { AthletesTable } from "./athletes-table"
import { PadronFilters } from "./padron-filters"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

export default async function PadronPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; club?: string; page?: string }>
}) {
  const { q, club, page } = await searchParams
  const requestedPage = Math.max(1, Math.trunc(Number(page) || 1))
  const filtered = Boolean(q || club)

  const where = {
    ...(club ? { clubId: club } : {}),
    ...(q
      ? {
          OR: [
            { firstNames: { contains: q, mode: "insensitive" as const } },
            { lastNames: { contains: q, mode: "insensitive" as const } },
            { docNumber: { contains: q } },
          ],
        }
      : {}),
  }

  const season = await getCurrentSeason()

  const [total, clubs, categories] = await Promise.all([
    prisma.athlete.count({ where }),
    prisma.club.findMany({
      select: { id: true, name: true, code: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    season ? getSeasonCategories(season.id) : Promise.resolve([]),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)
  const athletes = await prisma.athlete.findMany({
    where,
    include: {
      club: { select: { id: true, name: true, code: true } },
      // Una afiliación por disciplina practicada: se traen todas las de la
      // temporada vigente para mostrar el estado de cada una.
      affiliations: season ? { where: { seasonId: season.id } } : { take: 0 },
    },
    orderBy: [{ lastNames: "asc" }, { firstNames: "asc" }],
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  })

  const clubName = club ? clubs.find((row) => row.id === club)?.name ?? null : null

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Padrón de deportistas"
        description={
          filtered
            ? `${plural(total, "resultado", "resultados")} con los filtros aplicados`
            : plural(total, "deportista registrado", "deportistas registrados")
        }
        actions={
          <>
            <a
              href="/api/admin/padron/plantilla"
              download
              className={buttonClasses({ variant: "outline" })}
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Descargar plantilla
            </a>
            <Link href="/admin/padron/importar" className={buttonClasses()}>
              <Upload className="h-4 w-4" aria-hidden="true" /> Importar padrón
            </Link>
          </>
        }
      />

      <PadronFilters clubs={clubs} />

      <AthletesTable
        filter={filtered ? { q: q ?? "", clubName } : null}
        athletes={athletes.map((a) => {
          const disciplines = athleteDisciplines(a.disciplines)
          return {
            id: a.id,
            firstNames: a.firstNames,
            lastNames: a.lastNames,
            docType: a.docType,
            docNumber: a.docNumber,
            birthDateISO: a.birthDate.toISOString().slice(0, 10),
            sex: a.sex,
            clubId: a.clubId,
            clubName: a.club.name,
            isActive: a.isActive,
            categoryLabel: categoryLabelFor(categories, a.birthDate),
            disciplines,
            affiliationStates: disciplines.map((discipline) => ({
              discipline,
              state: affiliationState(
                a.affiliations.find((row) => row.discipline === discipline) ?? null
              ),
            })),
          }
        })}
        clubs={clubs}
      />

      <Pagination
        pathname="/admin/padron"
        currentPage={currentPage}
        totalPages={totalPages}
        query={{ q, club }}
        pageSize={PAGE_SIZE}
        totalItems={total}
      />
    </div>
  )
}
