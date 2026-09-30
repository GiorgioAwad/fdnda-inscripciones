import { CalendarRange } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { toAmount } from "@/lib/utils"
import { PageHeader } from "@/components/page-header"
import { SeasonsManager } from "./seasons-manager"

export const dynamic = "force-dynamic"

export default async function TemporadasPage() {
  const [seasons, categories] = await Promise.all([
    prisma.season.findMany({
      orderBy: { year: "desc" },
      include: {
        fees: { orderBy: { discipline: "asc" } },
        _count: { select: { clubAffiliations: true, athleteAffiliations: true } },
      },
    }),
    prisma.category.findMany({
      orderBy: [{ discipline: "asc" }, { sortOrder: "asc" }],
    }),
  ])

  const current = seasons.find((season) => season.isCurrent)

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarRange}
        title="Temporadas y cuotas"
        description={
          current
            ? `${current.name} está vigente: sus cuotas y categorías son las que usan el panel de afiliaciones, el padrón y el portal de los clubes.`
            : "No hay temporada vigente: los clubes no pueden afiliarse hasta que hagas vigente una."
        }
      />

      <SeasonsManager
        seasons={seasons.map((season) => ({
          id: season.id,
          year: season.year,
          name: season.name,
          startDateISO: season.startDate.toISOString().slice(0, 10),
          endDateISO: season.endDate.toISOString().slice(0, 10),
          fees: season.fees.map((fee) => ({
            discipline: fee.discipline,
            clubFee: toAmount(fee.clubFee),
            athleteFee: toAmount(fee.athleteFee),
          })),
          isCurrent: season.isCurrent,
          clubAffiliations: season._count.clubAffiliations,
          athleteAffiliations: season._count.athleteAffiliations,
        }))}
        categories={categories.map((category) => ({
          id: category.id,
          seasonId: category.seasonId,
          discipline: category.discipline,
          name: category.name,
          birthYearFrom: category.birthYearFrom,
          birthYearTo: category.birthYearTo,
          sortOrder: category.sortOrder,
        }))}
      />
    </div>
  )
}
