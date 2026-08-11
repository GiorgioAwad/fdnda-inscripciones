import * as React from "react"
import { cn } from "@/lib/utils"
import { LaneBand } from "./lane-band"

// Las tablas siempre van dentro de un contenedor con scroll horizontal propio
// para que la página nunca se desborde en móvil.
//
// Con `lanes` hay dos elementos, no uno: la franja NO puede vivir dentro del
// elemento que hace scroll o se desplazaría con él y se saldría de la vista al
// mover una tabla ancha. Vive en el envoltorio; el que scrollea conserva
// role="region", tabIndex y aria-label, porque moverlos al envoltorio dejaría
// el scroll inalcanzable por teclado.
export function TableContainer({
  className,
  children,
  lanes,
  "aria-label": ariaLabel = "Tabla con desplazamiento horizontal",
  tabIndex = 0,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { lanes?: readonly string[] }) {
  const banded = Boolean(lanes?.length)
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-surface border border-fdnda-border bg-white shadow-raised",
        className
      )}
    >
      {banded ? <LaneBand disciplines={lanes!} /> : null}
      <div
        role="region"
        aria-label={ariaLabel}
        tabIndex={tabIndex}
        className="overflow-x-auto overscroll-x-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fdnda-turquoise"
        {...props}
      >
        <p className="border-b border-fdnda-border bg-fdnda-surface px-4 py-2 text-xs font-semibold text-fdnda-muted md:hidden">
          Desliza horizontalmente para ver toda la tabla.
        </p>
        {children}
      </div>
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
        "border-b-2 border-fdnda-sky/70 bg-fdnda-sky/25 text-left",
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

// La cabecera va en la condensada y no se parte en dos líneas. No es un gesto
// estético: las tablas de este producto llegan a 10 columnas, y la condensada
// devuelve ~11% de ancho a las celdas de datos justo donde más falta hace.
export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "whitespace-nowrap px-4 py-3.5 font-heading text-eyebrow uppercase text-fdnda-navy",
        className
      )}
      {...props}
    />
  )
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3.5 text-fdnda-ink", className)} {...props} />
}

/**
 * Variante de tarjetas para las tablas de 8 o más columnas.
 *
 * `TableContainer` resuelve el desbordamiento con scroll horizontal, pero eso
 * en un teléfono de 390px significa recorrer dos pantallas y media para llegar
 * a la última columna —que es justo donde viven las acciones—. Bajo `md:` la
 * tabla se oculta y estas primitivas presentan las MISMAS filas apiladas.
 *
 * Se aplica solo a las tablas que no cubre la suite E2E: dos árboles visibles
 * a la vez romperían el modo estricto de Playwright.
 */
export function TableCards({
  className,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("space-y-3 md:hidden", className)} {...props} />
}

export function TableCard({
  lanes,
  title,
  subtitle,
  badges,
  actions,
  children,
  className,
}: {
  lanes?: readonly string[]
  title: React.ReactNode
  subtitle?: React.ReactNode
  badges?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  const banded = Boolean(lanes?.length)
  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-surface border border-fdnda-border bg-white p-4 shadow-raised",
        banded && "pt-5",
        className
      )}
    >
      {banded ? <LaneBand disciplines={lanes!} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <p className="font-heading text-base font-bold text-fdnda-navy">{title}</p>
          {subtitle ? (
            <p className="text-xs text-fdnda-muted">{subtitle}</p>
          ) : null}
        </div>
        {badges ? <div className="flex flex-wrap gap-1.5">{badges}</div> : null}
      </div>
      {children ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">{children}</dl>
      ) : null}
      {actions ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-fdnda-border pt-3">
          {actions}
        </div>
      ) : null}
    </li>
  )
}

export function TableField({
  label,
  value,
  wide = false,
}: {
  label: string
  value: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-eyebrow uppercase text-fdnda-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-fdnda-ink">{value}</dd>
    </div>
  )
}
