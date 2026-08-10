import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { countPendingAffiliations, getCurrentSeason } from "@/lib/affiliations"
import { FEDERATION_NAME } from "@/lib/brand"
import { SignOutButton } from "@/components/sign-out-button"
import { PortalNav } from "@/components/portal-nav"
import {
  disciplineInWhere,
  explicitDisciplineAccess,
  isClubCoordinator,
} from "@/lib/club-access"
import { disciplineLabel } from "@/lib/disciplines"

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect("/login")
  }

  const clubId = user.clubId
  const season = clubId ? await getCurrentSeason() : null
  const access = explicitDisciplineAccess(user)
  const disciplineWhere = disciplineInWhere(user)

  // El único carrito visible es el de afiliaciones; las inscripciones usan
  // planillas persistentes con orden propia.
  const [clubInCart, athletesInCart, pendingAffiliations] =
    await Promise.all([
      clubId && season
        ? prisma.clubAffiliation.count({
            where: {
              clubId,
              seasonId: season.id,
              status: "PENDING",
              activeOrderId: null,
              ...disciplineWhere,
            },
          })
        : 0,
      clubId && season
        ? prisma.athleteAffiliation.count({
            where: {
              clubId,
              seasonId: season.id,
              status: "PENDING",
              activeOrderId: null,
              ...disciplineWhere,
            },
          })
        : 0,
      clubId ? countPendingAffiliations(clubId, access) : 0,
    ])

  return (
    <div className="min-h-dvh bg-fdnda-surface text-fdnda-ink">
      <a
        href="#contenido-principal"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-control bg-fdnda-navy px-4 py-3 text-sm font-semibold text-white transition-transform focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-fdnda-turquoise"
      >
        Saltar al contenido principal
      </a>

      <PortalNav
        clubName={
          isClubCoordinator(user)
            ? (user.clubName ?? "Panel de la federación")
            : `${user.clubName ?? "Club"} · ${user.disciplineAccess
                .map((discipline) => disciplineLabel(discipline))
                .join(" · ")}`
        }
        userName={user.name}
        affiliationCartCount={clubInCart + athletesInCart}
        pendingAffiliations={pendingAffiliations}
        signOutAction={
          <SignOutButton className="justify-start text-fdnda-ink hover:bg-fdnda-sky/35 hover:text-fdnda-navy" />
        }
      />

      <div className="flex min-h-dvh flex-col lg:pl-64">
        <main
          id="contenido-principal"
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>

        <footer className="print-hidden border-t border-fdnda-border bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-fdnda-muted sm:px-6 lg:px-8">
            {FEDERATION_NAME} · Portal de clubes
          </div>
        </footer>
      </div>
    </div>
  )
}
