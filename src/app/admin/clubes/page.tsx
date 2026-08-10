import { UsersRound } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { affiliationState, getCurrentSeason } from "@/lib/affiliations"
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
  const total = await prisma.club.count()
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
      affiliations: season ? { where: { seasonId: season.id }, take: 1 } : { take: 0 },
      _count: { select: { athletes: true } },
    },
  })

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
    affiliationState: affiliationState(club.affiliations[0] ?? null),
    users: club.users,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        icon={UsersRound}
        title="Clubes"
        description={`Gestiona los ${total} clubes y sus usuarios de acceso a la plataforma.`}
      />
      <ClubsManager clubs={data} />
      <Pagination
        pathname="/admin/clubes"
        currentPage={currentPage}
        totalPages={totalPages}
      />
    </div>
  )
}
