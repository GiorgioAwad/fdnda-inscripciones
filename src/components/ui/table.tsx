import * as React from "react"
import { cn } from "@/lib/utils"

// Las tablas siempre van dentro de un contenedor con scroll horizontal propio
// para que la página nunca se desborde en móvil.
export function TableContainer({
  className,
  children,
  "aria-label": ariaLabel = "Tabla con desplazamiento horizontal",
  tabIndex = 0,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      className={cn(
        "overflow-x-auto overscroll-x-contain rounded-surface border border-fdnda-border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-turquoise focus-visible:ring-offset-2",
        className
      )}
      {...props}
    >
      <p className="border-b border-fdnda-border bg-fdnda-surface px-4 py-2 text-xs font-semibold text-fdnda-muted md:hidden">
        Desliza horizontalmente para ver toda la tabla.
      </p>
      {children}
    </div>
  )
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full min-w-[44rem] text-sm", className)} {...props} />
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-fdnda-sky/70 bg-fdnda-sky/20 text-left",
        className
      )}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-fdnda-border", className)} {...props} />
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "transition-colors motion-reduce:transition-none hover:bg-fdnda-sky/15 focus-within:bg-fdnda-sky/15",
        className
      )}
      {...props}
    />
  )
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-fdnda-navy",
        className
      )}
      {...props}
    />
  )
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3.5 text-fdnda-ink", className)} {...props} />
}
