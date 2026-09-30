import { notFound, redirect } from "next/navigation"
import { Building2 } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/page-header"
import { ClubContactForm } from "./contact-form"
import { disciplineArrayWhere, isClubCoordinator } from "@/lib/club-access"

export const dynamic = "force-dynamic"

export default async function ClubPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin/clubes")

  const club = await prisma.club.findUnique({
    where: { id: user.clubId },
    include: {
      _count: {
        select: { athletes: { where: disciplineArrayWhere(user) } },
      },
    },
  })

  if (!club) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title="Mi club"
        description="El nombre, el código y la región solo los cambia la FDNDA: si alguno está mal, pídele la corrección."
      />

      <Card>
        <CardHeader>
          <h2 className="font-heading text-lg font-bold tracking-tight text-fdnda-navy">
            Datos en la FDNDA
          </h2>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">Nombre</dt>
              <dd className="mt-1 font-bold text-fdnda-ink">{club.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">Código</dt>
              <dd className="num mt-1 font-bold text-fdnda-ink">{club.code}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">Región</dt>
              <dd className="mt-1 font-bold text-fdnda-ink">{club.region || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">Deportistas en el padrón</dt>
              <dd className="num mt-1 font-bold text-fdnda-ink">{club._count.athletes}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">Estado en la FDNDA</dt>
              <dd className="mt-1">
                <Badge variant={club.isActive ? "success" : "danger"}>
                  {club.isActive ? "Habilitado" : "Desactivado"}
                </Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-heading text-lg font-bold tracking-tight text-fdnda-navy">
            Contacto del club
          </h2>
          <p className="text-sm text-fdnda-muted">
            Izipay usa estos datos como datos del comprador cuando pagas una orden.
          </p>
        </CardHeader>
        <CardContent>
          <ClubContactForm
            contactName={club.contactName ?? ""}
            contactPhone={club.contactPhone ?? ""}
            contactEmail={club.contactEmail ?? ""}
            canEdit={isClubCoordinator(user)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
