"use client"

import { useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ClipboardCheck, CreditCard, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { disciplineStyle } from "@/lib/disciplines"
import { formatMoney } from "@/lib/utils"
import { checkoutAction, removeFromCartAction } from "./actions"

interface CartAthlete {
  id: string
  name: string
  isReserve: boolean
}

interface CartItem {
  id: string
  discipline: string
  eventName: string
  eventSlug: string
  modalityLabel: string
  sexLabel: string
  athletes: CartAthlete[]
  price: number
}

export function CartItems({
  items,
  total,
  totalLabel,
}: {
  items: CartItem[]
  total: number
  totalLabel: string
}) {
  const [isPending, startTransition] = useTransition()

  const handleRemove = (id: string) => {
    startTransition(async () => {
      const result = await removeFromCartAction(id)
      if (!result.success) toast.error(result.error)
    })
  }

  const handleCheckout = () => {
    startTransition(async () => {
      const result = await checkoutAction()
      // En éxito la acción redirige a /pago/[orderId]; solo llegamos aquí si falla.
      if (result && !result.success) toast.error(result.error)
    })
  }

  // Agrupar por evento para que el resumen sea claro.
  const byEvent = new Map<string, CartItem[]>()
  for (const item of items) {
    const list = byEvent.get(item.eventSlug) ?? []
    list.push(item)
    byEvent.set(item.eventSlug, list)
  }

  return (
    <div className="space-y-5">
      {[...byEvent.entries()].map(([eventSlug, eventItems]) => {
        // Quién compite qué: el club revisa por deportista, no solo por prueba.
        const byAthlete = new Map<string, { name: string; pruebas: string[] }>()
        for (const item of eventItems) {
          for (const athlete of item.athletes) {
            const row = byAthlete.get(athlete.id) ?? { name: athlete.name, pruebas: [] }
            row.pruebas.push(
              `${item.modalityLabel}${athlete.isReserve ? " (reserva)" : ""}`
            )
            byAthlete.set(athlete.id, row)
          }
        }
        const athleteRows = [...byAthlete.values()].sort((a, b) =>
          a.name.localeCompare(b.name, "es")
        )

        return (
          <Card key={eventSlug} className="animate-fade-up overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fdnda-border bg-fdnda-navy px-5 py-3.5">
              <h2 className="text-sm font-extrabold text-white">
                {eventItems[0].eventName}
              </h2>
              <Link href={`/eventos/${eventSlug}/resumen`}>
                <Button size="sm" variant="secondary">
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                  Hoja de resumen
                </Button>
              </Link>
            </div>

            <ul className="divide-y divide-fdnda-border">
              {eventItems.map((item) => {
                const style = disciplineStyle(item.discipline)
                const Icon = style.icon
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-fdnda-sky-soft sm:px-5"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-white ${style.chip}`}
                        title={style.label}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-fdnda-ink">
                          {item.modalityLabel}{" "}
                          <span className="text-xs font-medium text-fdnda-muted">
                            · {item.sexLabel}
                          </span>
                        </p>
                        <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                          {item.athletes
                            .map(
                              (athlete) =>
                                `${athlete.name}${athlete.isReserve ? " (reserva)" : ""}`
                            )
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-extrabold text-fdnda-ink">
                        {formatMoney(item.price)}
                      </span>
                      <button
                        onClick={() => handleRemove(item.id)}
                        disabled={isPending}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-control text-fdnda-muted transition-colors hover:bg-fdnda-red-soft hover:text-fdnda-red"
                        title="Quitar del carrito"
                        aria-label={`Quitar ${item.modalityLabel} del carrito`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <details className="border-t border-fdnda-border bg-fdnda-surface px-4 py-3 sm:px-5">
              <summary className="cursor-pointer text-sm font-bold text-fdnda-navy">
                Resumen por deportista ({athleteRows.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {athleteRows.map((row) => (
                  <li key={row.name} className="text-sm">
                    <span className="font-semibold text-fdnda-ink">{row.name}</span>
                    <span className="ml-2 text-xs text-fdnda-muted">
                      {row.pruebas.length} prueba(s)
                    </span>
                    <p className="text-xs leading-5 text-fdnda-muted">
                      {row.pruebas.join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        )
      })}

      <div className="sticky bottom-4">
        <div className="overflow-hidden rounded-surface border-2 border-fdnda-navy bg-white shadow-[0_12px_32px_rgb(2_55_125/0.12)]">
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                Total a pagar
              </p>
              <p className="text-3xl font-extrabold tabular-nums tracking-tight text-fdnda-navy">
                {totalLabel}
              </p>
            </div>
            <Button className="w-full sm:w-auto" size="lg" onClick={handleCheckout} disabled={isPending || total <= 0}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CreditCard className="h-4 w-4" aria-hidden="true" />
              )}
              {isPending ? "Preparando pago…" : "Proceder al pago"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
