import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Los montos viajan como Prisma.Decimal | number | string; normalizamos a número.
export function toAmount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function formatMoney(value: unknown, currency = "PEN"): string {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(toAmount(value))
}

// Fechas de calendario (@db.Date llega como Date UTC medianoche): formatear en
// UTC para no correr el día en Lima (UTC-5). Lección aprendida del ticketing.
export function formatDateOnly(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)
}

// Reloj de 24 horas («12 oct. 2026, 19:00»). El de 12 horas terminaba en
// «p. m.», y cada frase que cerraba con un plazo salía con doble punto
// («…hasta el 12 oct. 2026, 07:00 p. m..»); además, en un cierre de
// inscripciones «19:00» no se confunde con la mañana.
export function formatDateTimeLima(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Lima",
  }).format(d)
}

// Año de nacimiento de un atleta a partir de birthDate (@db.Date, UTC).
export function birthYearOf(birthDate: Date | string): number {
  const d = typeof birthDate === "string" ? new Date(birthDate) : birthDate
  return d.getUTCFullYear()
}

// Las disciplinas (etiqueta, icono y color) viven en lib/disciplines.ts.

export const SEX_RULE_LABELS: Record<string, string> = {
  MALE: "Varones",
  FEMALE: "Damas",
  MIXED: "Mixto",
  // No «Libre»: en natación y artística «libre» es un estilo y una rutina
  // (Solo Libre, Equipo Libre), y la etiqueta se leía como parte de la prueba.
  ANY: "Cualquier sexo",
}

export const SEX_LABELS: Record<string, string> = {
  M: "Masculino",
  F: "Femenino",
}

// «1 orden», «3 órdenes». Sustituye al «orden(es)» que obligaba a leer las dos
// formas a la vez. Recibe el plural explícito porque en español no se deriva
// con fiabilidad (orden → órdenes, afiliación → afiliaciones, país → países).
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60)
}

export function shortCode(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}-${random}`
}
