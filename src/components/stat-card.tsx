import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { LaneBand } from "@/components/ui/lane-band"
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
  disciplines,
  className,
}: {
  label: string
  value: string
  icon: LucideIcon
  tone?: StatTone
  href?: string
  // Cuando la métrica pertenece a una o varias disciplinas, la barra superior
  // deja de ser decorativa y pasa a ser la franja de andarivel: el mismo píxel
  // que antes solo identificaba la tarjeta ahora dice de qué deporte habla.
  disciplines?: readonly string[]
  className?: string
}) {
  const tones = toneClasses[tone]
  const banded = Boolean(disciplines?.length)

  const card = (
    <div
      className={cn(
        "group relative overflow-hidden rounded-surface border border-fdnda-border bg-white p-5 shadow-raised",
        href &&
          "transition-[border-color,box-shadow] duration-150 hover:border-fdnda-turquoise/60 hover:shadow-floating motion-reduce:transition-none",
        className
      )}
    >
      {banded ? (
        <LaneBand disciplines={disciplines!} />
      ) : (
        <div
          className={cn("absolute inset-x-0 top-0 h-lane", tones.bar)}
          aria-hidden="true"
        />
      )}
      {/* La etiqueta va arriba y el icono se aparta a la derecha para que la
          cifra disponga del ancho completo de la tarjeta. Con el icono al lado,
          un importe como «S/ 3,840.00» se recortaba en cuanto la rejilla pasaba
          de tres columnas. El icono es un marcador, no el protagonista. */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-eyebrow uppercase text-fdnda-muted">{label}</p>
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-chip",
            tones.chip
          )}
          aria-hidden="true"
        >
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      {/* El salto de rango del sistema: la cifra pasa de 26 a 36px y se dice en
          mono. Es el dato por el que existe la tarjeta. */}
      <p className="num mt-3 text-metric text-fdnda-navy">{value}</p>
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
