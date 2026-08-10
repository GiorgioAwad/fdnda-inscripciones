"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireClubUser } from "@/lib/auth"
import { getCurrentSeason, getSeasonFees } from "@/lib/affiliations"
import { DISCIPLINE_VALUES } from "@/lib/disciplines"
import type { ActionResult } from "@/lib/orders"
import { canAccessDiscipline, isClubCoordinator } from "@/lib/club-access"
import {
  consumeRateLimit,
  getRequestIpHash,
  writeAuditLog,
} from "@/lib/security"

export type { ActionResult } from "@/lib/orders"

const docNumberSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9-]{4,20}$/, "Documento inválido")

export type DocumentLookup =
  | { status: "INVALID"; message: string }
  // Ya está en la lista del club: no hay nada que crear.
  | { status: "OWN_CLUB"; athleteId: string; fullName: string }
  // Pertenece a otro club: el traspaso lo resuelve la federación.
  | { status: "OTHER_CLUB" }
  | { status: "AVAILABLE"; docNumber: string }

export async function lookupDocument(rawDocNumber: string): Promise<DocumentLookup> {
  let user: Awaited<ReturnType<typeof requireClubUser>>
  try {
    user = await requireClubUser()
  } catch {
    return { status: "INVALID", message: "No autorizado." }
  }

  const parsed = docNumberSchema.safeParse(rawDocNumber)
  if (!parsed.success) {
    return {
      status: "INVALID",
      message: "Ingresa un documento válido (4 a 20 caracteres).",
    }
  }

  const ipHash = await getRequestIpHash()
  const [userLimit, ipLimit] = await Promise.all([
    consumeRateLimit({
      namespace: "document-lookup-user",
      identity: user.id,
      limit: 30,
      windowSeconds: 60,
      blockSeconds: 5 * 60,
    }),
    consumeRateLimit({
      namespace: "document-lookup-ip",
      identity: ipHash,
      limit: 60,
      windowSeconds: 60,
      blockSeconds: 5 * 60,
    }),
  ])
  if (!userLimit.allowed || !ipLimit.allowed) {
    await writeAuditLog({
      actorId: user.id,
      actorRole: user.role,
      action: "athlete.document_lookup_rate_limited",
      success: false,
      ipHash,
    })
    return { status: "INVALID", message: "Demasiadas consultas. Intenta más tarde." }
  }

  const docNumber = parsed.data
  const existing = await prisma.athlete.findUnique({
    where: { docNumber },
    select: {
      id: true,
      firstNames: true,
      lastNames: true,
      clubId: true,
      disciplines: true,
    },
  })

  if (!existing) {
    return { status: "AVAILABLE", docNumber }
  }

  const fullName = `${existing.lastNames}, ${existing.firstNames}`

  if (existing.clubId === user.clubId) {
    if (
      isClubCoordinator(user) ||
      existing.disciplines.some((discipline) => canAccessDiscipline(user, discipline))
    ) {
      return { status: "OWN_CLUB", athleteId: existing.id, fullName }
    }
    return {
      status: "INVALID",
      message: "El documento ya pertenece a otra sección del club.",
    }
  }

  await writeAuditLog({
    actorId: user.id,
    actorRole: user.role,
    action: "athlete.document_lookup_conflict",
    targetType: "Athlete",
    success: true,
    ipHash,
  })
  return { status: "OTHER_CLUB" }
}

const newAthleteSchema = z.object({
  firstNames: z.string().trim().min(1, "Nombres requeridos"),
  lastNames: z.string().trim().min(1, "Apellidos requeridos"),
  docType: z.enum(["DNI", "CE", "PASAPORTE", "OTROS"]),
  docNumber: docNumberSchema,
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de nacimiento inválida"),
  sex: z.enum(["M", "F"]),
  disciplines: z
    .array(z.enum(DISCIPLINE_VALUES))
    .min(1, "Selecciona al menos una disciplina"),
  privacyAccepted: z.literal("on", {
    error: "Debes confirmar la autorización para registrar los datos.",
  }),
})

// Alta directa: el deportista entra al padrón y queda pendiente de afiliación.
// El club sale de la sesión, nunca del formulario.
export async function createClubAthlete(formData: FormData): Promise<ActionResult> {
  let user: Awaited<ReturnType<typeof requireClubUser>>
  try {
    user = await requireClubUser()
  } catch {
    return { success: false, error: "No autorizado." }
  }

  const parsed = newAthleteSchema.safeParse({
    firstNames: formData.get("firstNames"),
    lastNames: formData.get("lastNames"),
    docType: formData.get("docType"),
    docNumber: formData.get("docNumber"),
    birthDate: formData.get("birthDate"),
    sex: formData.get("sex"),
    disciplines: formData.getAll("disciplines").map(String),
    privacyAccepted: formData.get("privacyAccepted"),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  if (!parsed.data.disciplines.every((discipline) => canAccessDiscipline(user, discipline))) {
    return { success: false, error: "No autorizado para una de las disciplinas." }
  }

  const { birthDate, disciplines } = parsed.data
  const data = {
    firstNames: parsed.data.firstNames,
    lastNames: parsed.data.lastNames,
    docType: parsed.data.docType,
    docNumber: parsed.data.docNumber,
    sex: parsed.data.sex,
  }
  const [y, m, d] = birthDate.split("-").map(Number)
  const birth = new Date(Date.UTC(y, m - 1, d))
  const currentYear = new Date().getUTCFullYear()

  if (y < 1900 || y > currentYear) {
    return { success: false, error: "Revisa el año de nacimiento." }
  }

  const season = await getCurrentSeason()
  // Una cuota por disciplina practicada; las que no tienen tarifa este año
  // quedan sin afiliación hasta que la federación la fije.
  const fees = season ? await getSeasonFees(season.id) : null

  try {
    await prisma.$transaction(async (tx) => {
      const athlete = await tx.athlete.create({
        data: {
          ...data,
          disciplines,
          birthDate: birth,
          clubId: user.clubId,
          privacyNoticeVersion: "2026-08-10",
          privacyAcceptedAt: new Date(),
          privacyAcceptedByUserId: user.id,
        },
      })

      // Sin temporada vigente el deportista queda en el padrón; la afiliación se
      // genera después, cuando la federación habilite la temporada.
      if (season && fees) {
        const billable = disciplines.filter((discipline) => fees.has(discipline))
        if (billable.length > 0) {
          await tx.athleteAffiliation.createMany({
            data: billable.map((discipline) => ({
              athleteId: athlete.id,
              clubId: user.clubId,
              seasonId: season.id,
              discipline,
              fee: fees.get(discipline)!.athleteFee,
              validFrom: season.startDate,
              validTo: season.endDate,
            })),
          })
        }
      }
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: "Ya existe un deportista con ese documento. Consulta a la federación.",
      }
    }
    console.error("createClubAthlete error:", error)
    return { success: false, error: "No se pudo registrar al deportista." }
  }

  revalidatePath("/deportistas")
  revalidatePath("/afiliacion", "layout")
  revalidatePath("/inicio")
  return { success: true }
}
