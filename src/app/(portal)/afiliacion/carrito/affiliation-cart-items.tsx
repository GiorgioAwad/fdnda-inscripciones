"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Building2, CreditCard, Loader2, Trash2, User } from "lucide-react"
import { DisciplineIcon } from "@/components/discipline-icon"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DISCIPLINES, type DisciplineValue } from "@/lib/disciplines"
import { formatMoney } from "@/lib/utils"
import { checkoutAffiliationAction, removeAffiliationAction } from "../actions"

export interface AffiliationCartItem {
  id: string
  kind: "CLUB" | "ATHLETE"
  discipline: DisciplineValue
  title: string
  subtitle: string
  fee: number
}

export function AffiliationCartItems({
  items,
  totalLabel,
  expirationMinutes,
}: {
  items: AffiliationCartItem[]
  totalLabel: string
  expirationMinutes: number
}) {
  // Quitar y pagar son transiciones separadas: antes compartían una sola y, al
  // quitar un ítem, el botón de pago mostraba «Preparando pago…».
  const [isRemoving, startRemoving] = useTransition()
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [isCheckingOut, startCheckout] = useTransition()
  const busy = isRemoving || isCheckingOut

  const handleRemove = (item: AffiliationCartItem) => {
    const label = `${item.title} (${DISCIPLINES[item.discipline].label})`
    setRemovingKey(`${item.kind}-${item.id}`)
    startRemoving(async () => {
      const result = await removeAffiliationAction({
        kind: item.kind,
        affiliationId: item.id,
      })
      if (result.success) toast.success(`${label} salió del carrito`)
      else toast.error(result.error)
      setRemovingKey(null)
    })
  }

  const handleCheckout = () => {
    startCheckout(async () => {
      const result = await checkoutAffiliationAction()
      // En éxito la acción redirige a /pago/[orderId]; solo llegamos aquí si falla.
      if (result && !result.success) toast.error(result.error)
    })
  }

  // Agrupado por disciplina: cada una se cobra aparte, así que el club ve de
  // inmediato cuánto le cuesta cada deporte antes de pagar.
  const byDiscipline = new Map<DisciplineValue, AffiliationCartItem[]>()
  for (const item of items) {
    const list = byDiscipline.get(item.discipline) ?? []
    list.push(item)
    byDiscipline.set(item.discipline, list)
  }

  return (
    <div className="space-y-5">
      {[...byDiscipline.entries()].map(([discipline, groupItems]) => {
        const style = DISCIPLINES[discipline]
        const subtotal = groupItems.reduce((sum, item) => sum + item.fee, 0)

        return (
          <Card key={discipline} className="animate-fade-up overflow-hidden">
            <div
              className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-white ${style.chip}`}
            >
              <h2 className="flex items-center gap-2 text-sm font-extrabold">
                <DisciplineIcon
                  discipline={discipline}
                  tone="light"
                  className="h-4 w-4"
                />
                {style.label}
              </h2>
              <p className="num text-sm font-bold">{formatMoney(subtotal)}</p>
            </div>
            <ul className="divide-y divide-fdnda-border">
              {groupItems.map((item) => {
                const key = `${item.kind}-${item.id}`
                return (
                  <li
                    key={key}
                    className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-fdnda-sky-soft sm:px-5"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-white ${
                          item.kind === "CLUB" ? "bg-fdnda-navy" : "bg-fdnda-turquoise"
                        }`}
                      >
                        {item.kind === "CLUB" ? (
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <User className="h-4 w-4" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-fdnda-ink">{item.title}</p>
                        <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                          {item.subtitle}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-extrabold text-fdnda-ink">
                        {formatMoney(item.fee)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemove(item)}
                        disabled={busy}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-control text-fdnda-muted transition-colors hover:bg-fdnda-red-soft hover:text-fdnda-red disabled:cursor-not-allowed disabled:opacity-55"
                        title="Quitar del carrito"
                        aria-label={`Quitar ${item.title} (${style.label}) del carrito`}
                      >
                        {removingKey === key ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}

      <div className="sticky bottom-4">
        <div className="overflow-hidden rounded-surface border-2 border-fdnda-navy bg-white shadow-overlay">
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                Total a pagar
              </p>
              <p className="num text-3xl font-extrabold tracking-tight text-fdnda-navy">
                {totalLabel}
              </p>
              <p className="mt-1 max-w-md text-xs leading-5 text-fdnda-muted">
                Al pagar se crea una orden que tienes {expirationMinutes} minutos para
                completar. Si no se paga, las afiliaciones vuelven al carrito.
              </p>
            </div>
            <Button
              className="w-full sm:w-auto"
              size="lg"
              onClick={handleCheckout}
              disabled={busy || items.length === 0}
            >
              {isCheckingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CreditCard className="h-4 w-4" aria-hidden="true" />
              )}
              {isCheckingOut ? "Creando la orden…" : `Pagar ${totalLabel}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
