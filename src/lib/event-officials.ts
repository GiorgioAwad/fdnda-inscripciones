import { Prisma, type Discipline, type DocType, type EventOfficialRole } from "@prisma/client"
import { z } from "zod"
import { prisma } from "./prisma"
import { disciplineLabel } from "./disciplines"

// Delegados y entrenadores que un club nombra para una disciplina de un evento.
// No pagan: se registran para que la FDNDA los acredite. Van por club + evento +
// disciplina, no por planilla, y se pueden cambiar hasta el cierre de
// inscripciones aunque las planillas del club ya estén pagadas.

export type OfficialRoleValue = EventOfficialRole

export const OFFICIAL_ROLE_LABELS: Record<OfficialRoleValue, string> = {
  DELEGATE: "Delegado",
  COACH: "Entrenador",
}

export const OFFICIAL_ROLE_PLURALS: Record<OfficialRoleValue, string> = {
  DELEGATE: "Delegados",
  COACH: "Entrenadores",
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  DNI: "DNI",
  CE: "CE",
  PASAPORTE: "Pasaporte",
  OTROS: "Otro",
}

/** Topes que el formulario del admin admite (y el CHECK de la base). */
export const MAX_DELEGATES_LIMIT = 5
export const MAX_COACHES_LIMIT = 10

export interface OfficialLimits {
  maxDelegates: number
  maxCoaches: number
  requiresDelegate: boolean
}

/** Lo que vale una disciplina sin fila de configuración (eventos antiguos). */
export const DEFAULT_OFFICIAL_LIMITS: OfficialLimits = {
  maxDelegates: 1,
  maxCoaches: 3,
  requiresDelegate: false,
}

// Forma mínima: así lo pueden llamar las piezas que ya cargan la config de la
// disciplina sin depender del tipo de Prisma.
export interface OfficialLimitsSource {
  discipline: string
  maxDelegates?: number
  maxCoaches?: number
  requiresDelegate?: boolean
}

export function officialLimitsFor(
  configs: readonly OfficialLimitsSource[],
  discipline: string
): OfficialLimits {
  const row = configs.find((config) => config.discipline === discipline)
  if (!row) return DEFAULT_OFFICIAL_LIMITS
  const maxDelegates = row.maxDelegates ?? DEFAULT_OFFICIAL_LIMITS.maxDelegates
  return {
    maxDelegates,
    maxCoaches: row.maxCoaches ?? DEFAULT_OFFICIAL_LIMITS.maxCoaches,
    // Sin cupo de delegado no puede ser obligatorio nombrarlo.
    requiresDelegate: maxDelegates > 0 && (row.requiresDelegate ?? false),
  }
}

export function maxForRole(limits: OfficialLimits, role: OfficialRoleValue) {
  return role === "DELEGATE" ? limits.maxDelegates : limits.maxCoaches
}

/** «Hasta 1 delegado (obligatorio) y 3 entrenadores», para el admin. */
export function officialLimitsSummary(limits: OfficialLimits) {
  if (limits.maxDelegates === 0 && limits.maxCoaches === 0) return "No se piden"
  const parts: string[] = []
  if (limits.maxDelegates > 0) {
    parts.push(
      `${limits.maxDelegates === 1 ? "1 delegado" : `${limits.maxDelegates} delegados`}${limits.requiresDelegate ? " (obligatorio)" : ""}`
    )
  }
  if (limits.maxCoaches > 0) {
    parts.push(limits.maxCoaches === 1 ? "1 entrenador" : `${limits.maxCoaches} entrenadores`)
  }
  return `Hasta ${parts.join(" y ")} por club`
}

export const officialPersonSchema = z.object({
  firstNames: z
    .string()
    .trim()
    .min(1, "Escribe los nombres.")
    .max(80, "Los nombres admiten hasta 80 caracteres."),
  lastNames: z
    .string()
    .trim()
    .min(1, "Escribe los apellidos.")
    .max(80, "Los apellidos admiten hasta 80 caracteres."),
  docType: z.enum(["DNI", "CE", "PASAPORTE", "OTROS"], {
    error: "Elige el tipo de documento.",
  }),
  docNumber: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9-]{4,20}$/,
      "El N.º de documento debe tener de 4 a 20 letras, números o guiones."
    )
    .transform((value) => value.toUpperCase()),
})

export type OfficialPersonInput = z.input<typeof officialPersonSchema>

export function officialName(official: { firstNames: string; lastNames: string }) {
  return `${official.lastNames}, ${official.firstNames}`
}

export type EventOfficialResult =
  | { success: true; official: EventOfficialRecord }
  | { success: false; error: string }

export type EventOfficialRecord = Prisma.EventOfficialGetPayload<object>

// Hasta cuándo el club puede tocar a su gente: el mismo corte que las
// inscripciones.
async function eventOpenFor(
  tx: Prisma.TransactionClient,
  eventId: string,
  discipline: Discipline,
  now: Date
): Promise<{ ok: true; limits: OfficialLimits } | { ok: false; error: string }> {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: {
      status: true,
      registrationDeadline: true,
      disciplines: true,
      disciplineConfigs: true,
    },
  })
  if (!event || !event.disciplines.includes(discipline)) {
    return { ok: false, error: "La competencia ya no está disponible. Recarga la página." }
  }
  if (event.status !== "OPEN" || event.registrationDeadline < now) {
    return {
      ok: false,
      error:
        "Las inscripciones de esta competencia ya cerraron: el delegado y los entrenadores ya no se pueden cambiar.",
    }
  }
  return { ok: true, limits: officialLimitsFor(event.disciplineConfigs, discipline) }
}

export async function saveEventOfficial(input: {
  eventId: string
  clubId: string
  discipline: Discipline
  role: OfficialRoleValue
  /** Presente al corregir a alguien ya nombrado. */
  officialId?: string
  person: OfficialPersonInput
  now?: Date
}): Promise<EventOfficialResult> {
  const parsed = officialPersonSchema.safeParse(input.person)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const person = parsed.data
  const now = input.now ?? new Date()

  try {
    return await prisma.$transaction(async (tx) => {
      // Serializa los cambios del mismo club en la misma disciplina: sin esto,
      // dos altas simultáneas podrían pasar el tope a la vez.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`officials:${input.eventId}:${input.clubId}:${input.discipline}`}))`

      const open = await eventOpenFor(tx, input.eventId, input.discipline, now)
      if (!open.ok) return { success: false as const, error: open.error }
      const max = maxForRole(open.limits, input.role)
      const roleLabel = OFFICIAL_ROLE_LABELS[input.role].toLowerCase()

      if (input.officialId) {
        const current = await tx.eventOfficial.findFirst({
          where: {
            id: input.officialId,
            eventId: input.eventId,
            clubId: input.clubId,
            discipline: input.discipline,
          },
          select: { id: true, role: true },
        })
        if (!current) {
          return {
            success: false as const,
            error: "Esa persona ya no está nombrada. Recarga la página.",
          }
        }
        const official = await tx.eventOfficial.update({
          where: { id: current.id },
          data: person,
        })
        return { success: true as const, official }
      }

      if (max === 0) {
        return {
          success: false as const,
          error: `Esta competencia no pide ${roleLabel}s en ${disciplineLabel(input.discipline)}.`,
        }
      }
      const count = await tx.eventOfficial.count({
        where: {
          eventId: input.eventId,
          clubId: input.clubId,
          discipline: input.discipline,
          role: input.role,
        },
      })
      if (count >= max) {
        return {
          success: false as const,
          error:
            max === 1
              ? `Ya nombraste al ${roleLabel} de ${disciplineLabel(input.discipline)}. Corrígelo o quítalo para nombrar a otro.`
              : `Ya nombraste a los ${max} ${roleLabel}s que admite ${disciplineLabel(input.discipline)}.`,
        }
      }
      const official = await tx.eventOfficial.create({
        data: {
          eventId: input.eventId,
          clubId: input.clubId,
          discipline: input.discipline,
          role: input.role,
          ...person,
        },
      })
      return { success: true as const, official }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        success: false,
        error: `Esa persona ya está nombrada en ${disciplineLabel(input.discipline)} para esta competencia.`,
      }
    }
    console.error("saveEventOfficial error:", error)
    return { success: false, error: "No se pudo guardar. Vuelve a intentarlo." }
  }
}

export async function deleteEventOfficial(input: {
  eventId: string
  clubId: string
  /** La disciplina que el usuario puede tocar: otra no se borra. */
  discipline: Discipline
  officialId: string
  now?: Date
}): Promise<{ success: true } | { success: false; error: string }> {
  const now = input.now ?? new Date()
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.eventOfficial.findFirst({
        where: {
          id: input.officialId,
          eventId: input.eventId,
          clubId: input.clubId,
          discipline: input.discipline,
        },
        select: { id: true, discipline: true },
      })
      // Ya no está: el resultado que el club quería ya se cumple.
      if (!current) return { success: true as const }
      const open = await eventOpenFor(tx, input.eventId, current.discipline, now)
      if (!open.ok) return { success: false as const, error: open.error }
      await tx.eventOfficial.delete({ where: { id: current.id } })
      return { success: true as const }
    })
  } catch (error) {
    console.error("deleteEventOfficial error:", error)
    return { success: false, error: "No se pudo quitar. Vuelve a intentarlo." }
  }
}

export async function listEventOfficials(input: {
  eventId: string
  clubId?: string
  disciplines?: readonly Discipline[]
}) {
  return prisma.eventOfficial.findMany({
    where: {
      eventId: input.eventId,
      ...(input.clubId ? { clubId: input.clubId } : {}),
      ...(input.disciplines ? { discipline: { in: [...input.disciplines] } } : {}),
    },
    include: { club: { select: { name: true, code: true } } },
    orderBy: [
      { discipline: "asc" },
      { role: "asc" },
      { lastNames: "asc" },
      { firstNames: "asc" },
    ],
  })
}
