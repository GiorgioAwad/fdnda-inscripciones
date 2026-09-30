import Link from "next/link"
import { redirect } from "next/navigation"
import { Clock3, CreditCard, ShoppingBag } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getAffiliationCart } from "@/lib/affiliations"
import type { DisciplineValue } from "@/lib/disciplines"
import { ORDER_EXPIRATION_MINUTES } from "@/lib/orders"
import { formatDateOnly, formatDateTimeLima, formatMoney, toAmount } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { buttonClasses } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { AffiliationCartItems } from "./affiliation-cart-items"
import { explicitDisciplineAccess, orderAccessWhere } from "@/lib/club-access"

export const dynamic = "force-dynamic"

export default async function CarritoAfiliacionesPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  // El carrito es de cada club; la federación revisa las afiliaciones en su panel.
  if (!user.clubId) redirect("/admin/afiliaciones")

  // getAffiliationCart expira primero las órdenes vencidas: la orden abierta
  // se busca después para no mostrar una que acaba de volver al carrito.
  const cart = await getAffiliationCart(user.clubId, explicitDisciplineAccess(user))
  const openOrder = await prisma.order.findFirst({
    where: {
      clubId: user.clubId,
      kind: "AFFILIATION",
      status: "PENDING",
      ...orderAccessWhere(user),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, code: true, totalAmount: true, expiresAt: true },
  })
  const isEmpty = cart.clubs.length === 0 && cart.athletes.length === 0

  const vigencia = cart.season
    ? `Vigencia ${formatDateOnly(cart.season.startDate)} – ${formatDateOnly(cart.season.endDate)}`
    : ""

  // Una orden PENDING cuyo plazo ya pasó y sigue viva quedó reservada para
  // conciliación (tuvo un intento de pago con Izipay): no se invita a pagarla.
  const openOrderInReview = openOrder ? openOrder.expiresAt < new Date() : false

  const openOrderNotice = openOrder ? (
    openOrderInReview ? (
      <>
        La orden <strong className="num text-fdnda-ink">{openOrder.code}</strong> tuvo
        un intento de pago con Izipay que aún no se confirma. No vuelvas a pagarla: la
        FDNDA la conciliará.
      </>
    ) : (
      <>
        La orden <strong className="num text-fdnda-ink">{openOrder.code}</strong> por{" "}
        <strong className="num text-fdnda-ink">{formatMoney(openOrder.totalAmount)}</strong>{" "}
        vence el {formatDateTimeLima(openOrder.expiresAt)}. Si no se paga a tiempo, sus
        afiliaciones vuelven a este carrito.
      </>
    )
  ) : null

  const openOrderAction = openOrder ? (
    <Link href={`/pago/${openOrder.id}`} className={buttonClasses()}>
      <CreditCard className="h-4 w-4" aria-hidden="true" />
      {openOrderInReview ? `Revisar la orden ${openOrder.code}` : `Pagar orden ${openOrder.code}`}
    </Link>
  ) : null

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShoppingBag}
        title="Carrito de afiliación"
        description={
          cart.season
            ? `Cuotas de afiliación del club y de tus deportistas para la ${cart.season.name.toLowerCase()}. Cada afiliación queda vigente cuando su orden está pagada.`
            : undefined
        }
      />

      {isEmpty ? (
        <Card>
          {openOrder ? (
            <EmptyState
              icon={Clock3}
              title={openOrderInReview ? "Tienes una orden en conciliación" : "Tienes una orden por pagar"}
              action={openOrderAction}
            >
              {openOrderNotice}
            </EmptyState>
          ) : (
            <EmptyState
              icon={ShoppingBag}
              title="Tu carrito está vacío"
              action={
                <>
                  <Link href="/afiliacion" className={buttonClasses({ variant: "outline" })}>
                    Afiliar al club
                  </Link>
                  <Link href="/afiliacion?tab=deportistas" className={buttonClasses()}>
                    Afiliar deportistas
                  </Link>
                </>
              }
            >
              Agrega la cuota de afiliación del club o la de tus deportistas desde
              Estado de afiliación.
            </EmptyState>
          )}
        </Card>
      ) : (
        <>
          {openOrder ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-fdnda-warning-ring/70 bg-fdnda-warning-soft px-4 py-3 text-sm text-fdnda-warning"
            >
              <p className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{openOrderNotice}</span>
              </p>
              {openOrderAction}
            </div>
          ) : null}
          <AffiliationCartItems
            totalLabel={formatMoney(cart.total)}
            expirationMinutes={ORDER_EXPIRATION_MINUTES}
            items={[
              ...cart.clubs.map((row) => ({
                id: row.id,
                kind: "CLUB" as const,
                discipline: row.discipline as DisciplineValue,
                title: "Cuota de afiliación del club",
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
        </>
      )}
    </div>
  )
}
