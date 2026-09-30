"use client"

import Link from "next/link"
import { CalendarX2, ShieldAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonClasses } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/empty-state"
import { disciplineLabel } from "@/lib/disciplines"
import { formatDateOnly } from "@/lib/utils"
import type { EventView } from "../types"

// Solo se ve en una planilla que todavía no tiene competencia (se entró sin
// elegir una desde Inscripciones). La lista ya viene filtrada a las disciplinas
// en las que el club está afiliado, así que un club sin afiliaciones ve el
// camino para afiliarse en vez de una lista vacía sin explicación.

export function EventStep({
  events,
  disabled,
  hasAffiliations,
  onSelect,
}: {
  events: EventView[]
  disabled: boolean
  hasAffiliations: boolean
  onSelect: (eventId: string) => void
}) {
  if (!hasAffiliations) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="Tu club no tiene afiliaciones vigentes"
          action={
            <Link href="/afiliacion" className={buttonClasses()}>
              Afiliar a mi club
            </Link>
          }
        >
          Solo puedes inscribir en competencias de las disciplinas en las que tu
          club está afiliado esta temporada.
        </EmptyState>
      </Card>
    )
  }

  if (events.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CalendarX2}
          title="No hay competencias con inscripción abierta"
          action={
            <Link href="/inscripciones" className={buttonClasses({ variant: "outline" })}>
              Volver a Inscripciones
            </Link>
          }
        >
          Cuando la FDNDA abra inscripciones en tus disciplinas, aparecerán aquí.
        </EmptyState>
      </Card>
    )
  }

  return (
    <section className="space-y-4" aria-labelledby="step-event">
      <div>
        <h2 id="step-event" className="font-heading text-xl font-bold text-fdnda-navy">
          Competencias con inscripción abierta
        </h2>
        <p className="mt-1 text-sm text-fdnda-muted">
          Cada planilla corresponde a una sola competencia.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {events.map((event) => {
          const titleId = `event-${event.id}-title`
          return (
            <Card key={event.id} className="p-5">
              <h3 id={titleId} className="font-heading text-lg font-bold text-fdnda-navy">
                {event.name}
              </h3>
              <p className="mt-1 text-sm text-fdnda-muted">
                {formatDateOnly(event.startDate)} – {formatDateOnly(event.endDate)}
                {[event.venue, event.city].filter(Boolean).length > 0
                  ? ` · ${[event.venue, event.city].filter(Boolean).join(", ")}`
                  : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {event.disciplines.map((discipline) => (
                  <Badge key={discipline} variant="info">
                    {disciplineLabel(discipline)}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-xs font-semibold text-fdnda-muted">
                Inscripción hasta el {event.registrationDeadlineLabel}
                {event.seasonName ? ` · ${event.seasonName}` : ""}
              </p>
              <Button
                className="mt-4"
                onClick={() => onSelect(event.id)}
                disabled={disabled}
                aria-describedby={titleId}
              >
                Inscribir en esta competencia
              </Button>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
