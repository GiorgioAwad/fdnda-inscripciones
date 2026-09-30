import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Un estado vacío responde tres cosas: qué es este vacío (primer uso, filtro
// sin resultados, falta de permiso, algo que todavía no ocurre), por qué
// importa y qué hacer ahora. `action` es ese «ahora»: un enlace o botón con
// verbo y objeto, nunca un «Ver más».
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className
      )}
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-panel border border-fdnda-sky bg-fdnda-sky/30 text-fdnda-navy"
        aria-hidden="true"
      >
        <Icon className="h-7 w-7" />
      </div>
      <p className="font-heading text-lg font-bold text-fdnda-navy">{title}</p>
      {children ? (
        <div className="max-w-md text-sm leading-6 text-fdnda-muted">{children}</div>
      ) : null}
      {action ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
