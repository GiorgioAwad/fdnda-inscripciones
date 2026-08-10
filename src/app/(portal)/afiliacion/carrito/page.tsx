import Link from "next/link"
import { redirect } from "next/navigation"
import { ShoppingBag } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { getAffiliationCart } from "@/lib/affiliations"
import type { DisciplineValue } from "@/lib/disciplines"
import { formatDateOnly, formatMoney, toAmount } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { AffiliationCartItems } from "./affiliation-cart-items"
import { explicitDisciplineAccess } from "@/lib/club-access"

export const dynamic = "force-dynamic"

export default async function CarritoAfiliacionesPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  if (!user.clubId) {
    return (
      <Card>
        <EmptyState icon={ShoppingBag} title="Carrito no disponible">
          El carrito de afiliaciones solo está disponible para usuarios de club.
        </EmptyState>
      </Card>
    )
  }

  const cart = await getAffiliationCart(user.clubId, explicitDisciplineAccess(user))
  const isEmpty = cart.clubs.length === 0 && cart.athletes.length === 0

  const vigencia = cart.season
    ? `Vigencia ${formatDateOnly(cart.season.startDate)} – ${formatDateOnly(cart.season.endDate)}`
    : ""

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShoppingBag}
        eyebrow="Afiliación"
        title="Carrito de afiliación"
        description="Cuota anual del club y de los deportistas, por disciplina. Se activan al completar el pago."
      />

      {isEmpty ? (
        <Card>
          <EmptyState icon={ShoppingBag} title="Tu carrito de afiliación está vacío">
            <p>Agrega la cuota del club o selecciona deportistas por afiliar.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/afiliacion">
                <Button variant="outline">Afiliación del club</Button>
              </Link>
              <Link href="/afiliacion?tab=deportistas">
                <Button>Deportistas por afiliar</Button>
              </Link>
            </div>
          </EmptyState>
        </Card>
      ) : (
        <AffiliationCartItems
          totalLabel={formatMoney(cart.total)}
          items={[
            ...cart.clubs.map((row) => ({
              id: row.id,
              kind: "CLUB" as const,
              discipline: row.discipline as DisciplineValue,
              title: `Afiliación del club — ${row.club.name}`,
              subtitle: vigencia,
              fee: toAmount(row.fee),
            })),
            ...cart.athletes.map((row) => ({
              id: row.id,
              kind: "ATHLETE" as const,
              discipline: row.discipline as DisciplineValue,
              title: `${row.athlete.lastNames}, ${row.athlete.firstNames}`,
              subtitle: `${row.athlete.docType} ${row.athlete.docNumber} · ${vigencia}`,
              fee: toAmount(row.fee),
            })),
          ]}
        />
      )}
    </div>
  )
}
