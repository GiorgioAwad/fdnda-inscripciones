import {
  EVENT_DEADLINE_PASSED_BADGE,
  EVENT_STATUS_BADGE,
  type BadgeVariant,
} from "@/components/ui/badge"

// El estado guardado de una competencia no basta para saber qué ve el club: una
// competencia OPEN cuyo cierre ya pasó desaparece de su lista
// (lib/club-events.ts, requireFutureDeadline) aunque siga en OPEN. Este archivo
// deriva «Plazo vencido» en un solo lugar para el listado y el detalle.

export function isDeadlinePassed(deadline: Date, now: Date = new Date()): boolean {
  return deadline.getTime() < now.getTime()
}

export function eventStatusBadge(
  status: string,
  deadline: Date,
  now: Date = new Date()
): { label: string; variant: BadgeVariant } {
  if (status === "OPEN" && isDeadlinePassed(deadline, now)) {
    return EVENT_DEADLINE_PASSED_BADGE
  }
  return EVENT_STATUS_BADGE[status] ?? { label: status, variant: "neutral" }
}
