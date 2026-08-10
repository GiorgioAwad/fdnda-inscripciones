import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Encabezado de página consistente: icono en chip degradado + título + acciones.
export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        {Icon ? (
          // Antes era navy sólido, el mismo color exacto del chip de Clavados: en
          // cada pantalla convivían un adorno de interfaz y una marca de
          // disciplina idénticos. El cromo cede el navy sólido para que un
          // rectángulo azul lleno signifique Clavados y nada más.
          <div
            className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-fdnda-sky/40 text-fdnda-navy ring-1 ring-inset ring-fdnda-sky"
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-fdnda-turquoise-deep">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="font-heading text-2xl font-extrabold leading-tight tracking-tight text-fdnda-navy sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-6 text-fdnda-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
