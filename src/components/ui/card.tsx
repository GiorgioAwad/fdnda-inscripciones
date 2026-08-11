import * as React from "react"
import { cn } from "@/lib/utils"
import { LaneBand } from "./lane-band"

/**
 * `lanes` es opcional y aditiva: sin ella el DOM es el mismo de siempre. Con
 * ella, la tarjeta declara de qué disciplina(s) habla y lo dice con color en el
 * borde superior.
 *
 * `children` se desestructura a propósito en vez de viajar dentro de `props`:
 * hace falta insertar la franja ANTES de los hijos, y con el spread React
 * pisaría uno de los dos.
 */
export function Card({
  className,
  lanes,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { lanes?: readonly string[] }) {
  const banded = Boolean(lanes?.length)
  return (
    <div
      className={cn(
        "rounded-surface border border-fdnda-border bg-white shadow-raised",
        banded && "relative overflow-hidden",
        className
      )}
      {...props}
    >
      {banded ? <LaneBand disciplines={lanes!} /> : null}
      {children}
    </div>
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-heading text-lg font-bold tracking-tight text-fdnda-navy",
        className
      )}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm leading-6 text-fdnda-muted", className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-2", className)} {...props} />
}
