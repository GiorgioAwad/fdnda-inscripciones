import { Sparkles, Volleyball, Waves, type LucideIcon } from "lucide-react"

// Fuente única de las disciplinas de la federación. Antes la etiqueta, el icono y
// el color de cada una estaban repetidos con cuatro formas distintas (utils,
// eventos, inscripciones, modalities-manager) y agregar una disciplina obligaba
// a tocar ocho archivos. Ahora se agrega acá y en el enum de Prisma.

export const DISCIPLINE_VALUES = [
  "DIVING",
  "ARTISTIC_SWIMMING",
  "WATER_POLO",
] as const

export type DisciplineValue = (typeof DISCIPLINE_VALUES)[number]

export interface DisciplineStyle {
  label: string
  // Etiqueta corta para chips, pestañas y columnas estrechas.
  short: string
  icon: LucideIcon
  // Fondo sólido con texto blanco (avatares, cabeceras de sección).
  chip: string
  // Color de texto para precios y títulos sobre fondo claro.
  accent: string
  // Chip legible sobre el azul institucional (tarjetas de evento).
  onNavy: string
}

export const DISCIPLINES: Record<DisciplineValue, DisciplineStyle> = {
  DIVING: {
    label: "Clavados",
    short: "Clavados",
    icon: Waves,
    chip: "bg-fdnda-navy",
    accent: "text-fdnda-navy",
    onNavy: "bg-white text-fdnda-navy",
  },
  ARTISTIC_SWIMMING: {
    label: "Natación Artística",
    short: "Artística",
    icon: Sparkles,
    chip: "bg-fdnda-red",
    accent: "text-fdnda-red-deep",
    onNavy: "bg-fdnda-red text-white",
  },
  WATER_POLO: {
    // El turquesa de marca con texto blanco da 3.14:1 y no llega a AA (4.5:1).
    // El turquesa profundo llega a 4.78:1 sin salir de la paleta. En `onNavy` el
    // fondo se mantiene claro para que la píldora resalte sobre la tarjeta azul,
    // así que ahí lo que cambia es la tinta: navy profundo sobre turquesa, 4.51:1.
    label: "Polo Acuático",
    short: "Polo",
    icon: Volleyball,
    chip: "bg-fdnda-turquoise-deep",
    accent: "text-fdnda-turquoise-deep",
    onNavy: "bg-fdnda-turquoise text-fdnda-navy-deep",
  },
}

export function isDiscipline(value: unknown): value is DisciplineValue {
  return (
    typeof value === "string" &&
    (DISCIPLINE_VALUES as readonly string[]).includes(value)
  )
}

// Tolerante con disciplinas desconocidas (datos viejos): nunca devuelve undefined.
export function disciplineStyle(value: string): DisciplineStyle {
  return isDiscipline(value) ? DISCIPLINES[value] : DISCIPLINES.DIVING
}

export function disciplineLabel(value: string): string {
  return isDiscipline(value) ? DISCIPLINES[value].label : value
}

// Ordena una lista de disciplinas según DISCIPLINE_VALUES para que todas las
// vistas las presenten siempre en el mismo orden.
export function sortDisciplines(values: readonly string[]): DisciplineValue[] {
  return DISCIPLINE_VALUES.filter((value) => values.includes(value))
}
