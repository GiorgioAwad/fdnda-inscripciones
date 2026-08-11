import { disciplineStyle, sortDisciplines } from "@/lib/disciplines"
import { cn } from "@/lib/utils"

/**
 * La franja de andarivel: el borde superior de una superficie que carga datos.
 *
 * Su color CODIFICA la disciplina, con la misma asignación que ya usan el chip
 * y el acento (`lib/disciplines.ts`). Si el contenido toca varias, se reparte
 * en segmentos iguales, siempre en el orden canónico de DISCIPLINE_VALUES, de
 * modo que dos pantallas distintas nunca pintan el mismo par al revés.
 *
 * Sin disciplinas no pinta nada. Es deliberado: una franja que no significa
 * nada es ruido, y el sentido de esta es que un rectángulo de color valga como
 * dato incluso mirando la pantalla de lejos.
 *
 * El contenedor tiene que ser `relative` y recortar (`overflow-hidden`) para
 * que la franja siga el radio de la superficie.
 */
export function LaneBand({
  disciplines,
  strong = false,
  className,
}: {
  disciplines: readonly string[]
  strong?: boolean
  className?: string
}) {
  const lanes = sortDisciplines(disciplines)
  if (lanes.length === 0) return null

  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-10 flex",
        strong ? "h-lane-strong" : "h-lane",
        className
      )}
    >
      {lanes.map((discipline) => (
        <span
          key={discipline}
          className={cn("flex-1", disciplineStyle(discipline).lane)}
        />
      ))}
    </span>
  )
}
