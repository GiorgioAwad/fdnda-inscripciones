import * as React from "react"
import Link from "next/link"
import { ArrowLeft, type LucideIcon } from "lucide-react"
import { LaneBand } from "@/components/ui/lane-band"
import { cn } from "@/lib/utils"

// Encabezado de página consistente: icono en chip + título + acciones.
//
// Con `lanes` el encabezado deja de ser texto suelto sobre el fondo y pasa a
// «modo superficie»: una tarjeta con la franja de andarivel de las disciplinas
// de la pantalla. Sin `lanes` el markup es exactamente el de siempre, de modo
// que las ~20 pantallas que ya lo usan no cambian de caja.
export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  back,
  lanes,
  className,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  // Regreso a la pantalla madre («Volver a Competencias»). Sustituye al
  // antetítulo en mayúsculas que había sobre cada h1: repetía el nombre de la
  // sección que ya marca el menú y no llevaba a ningún lado.
  back?: { href: string; label: string }
  lanes?: readonly string[]
  className?: string
}) {
  const banded = Boolean(lanes?.length)
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        banded &&
          "relative overflow-hidden rounded-surface border border-fdnda-border bg-white p-5 pt-6 shadow-raised",
        className
      )}
    >
      {banded ? <LaneBand disciplines={lanes!} strong /> : null}
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
          {back ? (
            <Link
              href={back.href}
              className="mb-1.5 inline-flex min-h-8 items-center gap-1.5 rounded-chip text-sm font-semibold text-fdnda-turquoise-deep underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fdnda-turquoise"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {back.label}
            </Link>
          ) : null}
          <h1 className="font-heading text-3xl leading-tight text-fdnda-navy sm:text-4xl">
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
