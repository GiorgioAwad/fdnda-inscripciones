"use client"

import Link from "next/link"
import { CalendarX2, ShieldAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/empty-state"
import { disciplineLabel } from "@/lib/disciplines"
import { formatDateOnly } from "@/lib/utils"
import type { EventView, PlanView } from "../types"

// Paso 1: elegir la competencia. La lista ya viene filtrada a las disciplinas en
// las que el club está afiliado, así que un club sin afiliaciones ve el camino
// para regularizar en vez de una lista vacía sin explicación.

export function EventStep({
  events,
  plan,
  disabled,
  hasAffiliations,
  onSelect,
}: {
  events: EventView[]
  plan: PlanView
  disabled: boolean
  hasAffiliations: boolean
  onSelect: (eventId: string) => void
}) {
  if (!hasAffiliations) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="Todavía no tienes afiliaciones vigentes">
          <p>
            Solo puedes inscribirte en competencias de las disciplinas en las que
            tu club está afiliado esta temporada.
          </p>
          <Link href="/afiliacion" className="mt-4 inline-block">
            <Button>Ir a afiliación</Button>
          </Link>
        </EmptyState>
      </Card>
    )
  }

  if (events.length === 0) {
    return (
      <Card>
        <EmptyState icon={CalendarX2} title="No hay competencias abiertas">
          Por ahora no hay convocatorias de tus disciplinas con inscripción abierta.
        </EmptyState>
      </Card>
    )
  }

  return (
    <section className="space-y-4" aria-labelledby="step-event">
      <div>
        <h2 id="step-event" className="font-heading text-xl font-bold text-fdnda-navy">
          Elige la competencia
        </h2>
        <p className="mt-1 text-sm text-fdnda-muted">
          Cada planilla y cada orden pertenecen a una sola competencia.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {events.map((event) => {
          const selected = plan.event?.id === event.id
          return (
            <Card key={event.id} className={`p-5 ${selected ? "border-2 border-fdnda-navy" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-heading text-lg font-bold text-fdnda-navy">
                    {event.name}
                  </h3>
                  <p className="mt-1 text-sm text-fdnda-muted">
                    {formatDateOnly(event.startDate)} – {formatDateOnly(event.endDate)}
                    {[event.venue, event.city].filter(Boolean).length > 0
                      ? ` · ${[event.venue, event.city].filter(Boolean).join(", ")}`
                      : ""}
                  </p>
                </div>
                {selected ? <Badge variant="success">Seleccionada</Badge> : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {event.disciplines.map((discipline) => (
                  <Badge key={discipline} variant="info">
                    {disciplineLabel(discipline)}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-xs font-semibold text-fdnda-muted">
                Cierre: {formatDateOnly(event.registrationDeadline)}
                {event.seasonName ? ` · ${event.seasonName}` : ""}
              </p>
              {!selected ? (
                <Button
                  className="mt-4"
                  onClick={() => onSelect(event.id)}
                  disabled={disabled}
                >
                  Seleccionar
                </Button>
              ) : null}
            </Card>
          )
        })}
      </div>
    </section>
  )
}
