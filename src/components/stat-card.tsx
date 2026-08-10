import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Los tres primeros tonos son decorativos —identifican la tarjeta, no codifican
// datos— y por eso se nombran por el color que realmente pintan: antes se
// llamaban `cyan`, `violet` o `emerald` y ninguno pintaba eso. `cyan` y
// `emerald` además eran casi el mismo turquesa, así que se fusionaron.
//
// `warning` sí es semántico y comparte los tokens de la insignia: lo usan las
// tarjetas de «por regularizar», «sin vigencia» y «por pagar», que antes salían
// en el rojo de la marca y leían como error en vez de como pendiente.
//
// El número héroe siempre va en tinta oscura, para máxima legibilidad.
export type StatTone = "navy" | "turquoise" | "sky" | "warning"

const toneClasses: Record<StatTone, { chip: string; bar: string }> = {
  navy: {
    chip: "bg-fdnda-navy text-white",
    bar: "bg-fdnda-navy",
  },
  turquoise: {
    chip: "bg-fdnda-turquoise-deep text-white",
    bar: "bg-fdnda-turquoise-deep",
  },
  sky: {
    chip: "bg-fdnda-sky text-fdnda-navy",
    bar: "bg-fdnda-sky",
  },
  warning: {
    chip:
      "bg-fdnda-warning-soft text-fdnda-warning ring-1 ring-inset ring-fdnda-warning-ring",
    bar: "bg-fdnda-warning-ring",
  },
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "turquoise",
  href,
  className,
}: {
  label: string
  value: string
  icon: LucideIcon
  tone?: StatTone
  href?: string
  className?: string
}) {
  const tones = toneClasses[tone]

  const card = (
    <div
      className={cn(
        "group relative overflow-hidden rounded-surface border border-fdnda-border bg-white p-5",
        href &&
          "transition-colors duration-150 hover:border-fdnda-turquoise/60 motion-reduce:transition-none",
        className
      )}
    >
      <div
        className={cn("absolute inset-x-0 top-0 h-1", tones.bar)}
        aria-hidden="true"
      />
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-control",
            tones.chip
          )}
          aria-hidden="true"
        >
          <Icon className="h-5.5 w-5.5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-fdnda-muted">
            {label}
          </p>
          <p className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight text-fdnda-navy">
            {value}
          </p>
        </div>
      </div>
    </div>
  )

  return href ? (
    <Link
      href={href}
      className="block rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-turquoise focus-visible:ring-offset-2"
    >
      {card}
    </Link>
  ) : (
    card
  )
}
