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
        // El tamaño va fijo y NO usa text-xs a propósito: text-xs subió a 13px
        // para el cuerpo del producto, pero la insignia no puede crecer con él.
        // Hay celdas con tres insignias apiladas (padrón, afiliaciones) donde
        // un punto más rompe la altura de la fila.
        "inline-flex min-h-6 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-[0.01em] ring-1 ring-inset",
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
  FAILED: { label: "Pago rechazado", variant: "danger" },
  // CANCELLED solo lo escribe expireStaleOrders (lib/orders.ts): una orden que
  // venció sin pagarse. «Cancelada» sugería que alguien la anuló a propósito.
  CANCELLED: { label: "Expirada", variant: "neutral" },
}

export const EVENT_STATUS_BADGE: Record<
  string,
  { label: string; variant: BadgeVariant }
> = {
  DRAFT: { label: "Borrador", variant: "neutral" },
  OPEN: { label: "Inscripciones abiertas", variant: "success" },
  // Cerrar inscripciones es una operación normal, no un error: antes salía en
  // rojo y leía como fallo.
  CLOSED: { label: "Inscripciones cerradas", variant: "neutral" },
}

// Estado derivado, no guardado: el evento sigue OPEN pero su cierre ya pasó,
// así que los clubes ya no lo ven (lib/club-events.ts). Sin esto seguía en
// verde «Inscripciones abiertas» cuando en la práctica ya no lo estaba.
export const EVENT_DEADLINE_PASSED_BADGE: { label: string; variant: BadgeVariant } = {
  label: "Plazo vencido",
  variant: "warning",
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
  // «Vigente», no «Activa»: es la palabra de la temporada y de la vigencia, y
  // «activo» ya nombra otra cosa (un club o un usuario habilitado).
  ACTIVA: { label: "Vigente", variant: "success" },
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
