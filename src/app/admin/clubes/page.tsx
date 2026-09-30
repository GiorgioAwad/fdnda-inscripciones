import { UsersRound } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { affiliationState, getCurrentSeason } from "@/lib/affiliations"
import { sortDisciplines } from "@/lib/disciplines"
import { plural } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { Pagination } from "@/components/pagination"
import { ClubsManager } from "./clubs-manager"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

export default async function ClubesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const requestedPage = Math.max(1, Math.trunc(Number((await searchParams).page) || 1))
  const season = await getCurrentSeason()
  const [total, withoutUser, seasonFees] = await Promise.all([
    prisma.club.count(),
    prisma.club.count({ where: { users: { none: { role: "CLUB" } } } }),
    season
      ? prisma.seasonFee.findMany({
          where: { seasonId: season.id },
          select: { discipline: true },
        })
      : Promise.resolve([]),
  ])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)

  const clubs = await prisma.club.findMany({
    orderBy: { name: "asc" },
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      users: {
        where: { role: "CLUB" },
        select: {
          id: true,
          username: true,
          name: true,
          isActive: true,
          disciplineAccess: true,
        },
        orderBy: { createdAt: "asc" },
      },
      // La afiliación se paga por disciplina: una fila por cada una, no la
      // primera que devuelva la base.
      affiliations: season ? { where: { seasonId: season.id } } : { take: 0 },
      _count: { select: { athletes: true } },
    },
  })

  const offered = seasonFees.map((fee) => fee.discipline)

  const data = clubs.map((club) => ({
    id: club.id,
    name: club.name,
    code: club.code,
    region: club.region ?? "",
    contactName: club.contactName ?? "",
    contactPhone: club.contactPhone ?? "",
    contactEmail: club.contactEmail ?? "",
    isActive: club.isActive,
    athleteCount: club._count.athletes,
    affiliations: sortDisciplines([
      ...new Set([...offered, ...club.affiliations.map((row) => row.discipline)]),
    ]).map((discipline) => ({
      discipline,
      state: affiliationState(
        club.affiliations.find((row) => row.discipline === discipline) ?? null
      ),
    })),
    users: club.users,
  }))

  const description = [
    plural(total, "club registrado", "clubes registrados"),
    withoutUser > 0 ? `${withoutUser} sin usuario de acceso` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="space-y-6">
      <PageHeader icon={UsersRound} title="Clubes" description={description} />
      <ClubsManager clubs={data} seasonYear={season?.year ?? null} />
      <Pagination
        pathname="/admin/clubes"
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        totalItems={total}
      />
    </div>
  )
}
