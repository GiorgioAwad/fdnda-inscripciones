import { notFound, redirect } from "next/navigation"
import { Building2 } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
        eyebrow="Gestión del club"
        title="Información del club"
        description="Los datos de identidad los administra la federación; el contacto lo mantienes tú."
      />

      <Card>
        <CardHeader>
          <CardTitle>Datos registrados</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                Nombre
              </dt>
              <dd className="mt-1 font-bold text-fdnda-ink">{club.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                Código
              </dt>
              <dd className="mt-1 font-mono font-bold text-fdnda-ink">{club.code}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                Región
              </dt>
              <dd className="mt-1 font-bold text-fdnda-ink">{club.region || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                Deportistas
              </dt>
              <dd className="mt-1 flex items-center gap-2 font-bold text-fdnda-ink">
                {club._count.athletes}
                <Badge variant={club.isActive ? "success" : "danger"}>
                  {club.isActive ? "Club activo" : "Club inactivo"}
                </Badge>
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-fdnda-muted">
            ¿Necesitas corregir el nombre, el código o la región? Escríbele a la FDNDA.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contacto del club</CardTitle>
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
