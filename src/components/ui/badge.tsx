import * as React from "react"
import { cn } from "@/lib/utils"

// Las variantes se nombran por el papel que cumplen, no por el color que pintan.
// Antes se llamaban `green`, `yellow`, `purple`… pero todas mapeaban a colores
// FDNDA: `violet` pintaba celeste, `amber` pintaba rojo y `default` y `blue`
// eran la misma cadena. Había que leer este archivo para saber qué salía.
export type BadgeVariant =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "accent"

const variantClasses: Record<BadgeVariant, string> = {
  success: "bg-fdnda-success-soft text-fdnda-success ring-fdnda-success-ring",
  warning: "bg-fdnda-warning-soft text-fdnda-warning ring-fdnda-warning-ring",
  danger: "bg-fdnda-danger-soft text-fdnda-danger ring-fdnda-danger-ring",
  info: "bg-fdnda-info-soft text-fdnda-info ring-fdnda-info-ring",
  neutral: "bg-fdnda-neutral-soft text-fdnda-neutral ring-fdnda-neutral-ring",
  accent: "bg-fdnda-accent-soft text-fdnda-accent ring-fdnda-accent-ring",
}

export function Badge({
  className,
  variant = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
}

export const REGISTRATION_STATUS_BADGE: Record<
  string,
  { label: string; variant: BadgeVariant }
> = {
  IN_CART: { label: "En carrito", variant: "neutral" },
  PENDING_PAYMENT: { label: "Por pagar", variant: "warning" },
  PAID: { label: "Pagada", variant: "success" },
}

export const ORDER_STATUS_BADGE: Record<
  string,
  { label: string; variant: BadgeVariant }
> = {
  PENDING: { label: "Pendiente", variant: "warning" },
  PAID: { label: "Pagada", variant: "success" },
  FAILED: { label: "Fallida", variant: "danger" },
  CANCELLED: { label: "Cancelada", variant: "neutral" },
}

export const EVENT_STATUS_BADGE: Record<
  string,
  { label: string; variant: BadgeVariant }
> = {
  DRAFT: { label: "Borrador", variant: "neutral" },
  OPEN: { label: "Inscripciones abiertas", variant: "success" },
  CLOSED: { label: "Cerrado", variant: "danger" },
}

// Estados derivados de afiliación (ver affiliationState en lib/affiliations).
// «Por vencer» avisa de un plazo y «Pendiente de pago» pide una acción: son
// distintos, pero los dos piden atención sin ser un error, así que comparten
// `warning`. Si en el uso real se confunden, la salida es un icono que separe
// plazo de acción, no un color más.
export const AFFILIATION_STATE_BADGE: Record<
  string,
  { label: string; variant: BadgeVariant }
> = {
  ACTIVA: { label: "Activa", variant: "success" },
  POR_VENCER: { label: "Por vencer", variant: "warning" },
  PENDIENTE: { label: "Pendiente de pago", variant: "warning" },
  VENCIDA: { label: "Vencida", variant: "danger" },
  SIN_AFILIAR: { label: "Sin afiliar", variant: "neutral" },
}

export const ORDER_KIND_BADGE: Record<
  string,
  { label: string; variant: BadgeVariant }
> = {
  AFFILIATION: { label: "Afiliación", variant: "accent" },
  REGISTRATION: { label: "Inscripción", variant: "info" },
}
