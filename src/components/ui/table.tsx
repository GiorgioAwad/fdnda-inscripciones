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
        "border-b-2 border-fdnda-sky/70 bg-fdnda-sky-head text-left",
        className
      )}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-fdnda-border", className)} {...props} />
}

// `group` para que una celda fijada (ver `stickyCell`) pueda replicar el tinte
// de la fila: al tener fondo opaco propio, no lo hereda.
export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "group transition-colors motion-reduce:transition-none hover:bg-fdnda-sky/15 focus-within:bg-fdnda-sky/15",
        className
      )}
      {...props}
    />
  )
}

/**
 * Fija la última columna al borde derecho de una tabla que desborda.
 *
 * Las acciones viven en la última columna, que es justo la que se pierde al
 * desplazarse. Ajustar anchos hasta que quepa solo aplaza el problema: basta un
 * club con nombre largo o una pantalla de 1280px para volver a romperlo. Fijada,
 * la acción está siempre a la vista.
 *
 * El fondo tiene que ser OPACO —el resto de la tabla pasa por debajo— y por eso
 * la cabecera no puede usar el `bg-fdnda-sky/25` translúcido del `THead`.
 */
export const stickyCell = {
  head: "sticky right-0 z-20 bg-fdnda-sky-head border-l border-fdnda-border",
  cell: "sticky right-0 z-10 bg-white border-l border-fdnda-border group-hover:bg-fdnda-sky/15 group-focus-within:bg-fdnda-sky/15",
} as const

// La cabecera va en la condensada, que devuelve ~11% de ancho a las celdas de
// datos justo donde más falta hace: estas tablas llegan a 10 columnas.
//
// Y SIN `whitespace-nowrap`. Lo llevó un tiempo y era exactamente al revés de
// lo que se buscaba: en el panel de afiliaciones las columnas numéricas las
// dimensionaba su cabecera y no su dato, así que «Deportistas» ocupaba 115px
// para mostrar un solo dígito y la tabla se iba 165px por encima del
// contenedor. Dejar que un titular de dos palabras se parta en dos líneas es
// lo que hace que la tabla quepa.
export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "px-4 py-3.5 font-heading text-eyebrow uppercase text-fdnda-navy",
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
