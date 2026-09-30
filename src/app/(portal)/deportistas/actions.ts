"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireClubUser } from "@/lib/auth"
import { getCurrentSeason, getSeasonFees } from "@/lib/affiliations"
import { DISCIPLINE_VALUES, disciplineLabel } from "@/lib/disciplines"
import type { ActionResult } from "@/lib/orders"
import { canAccessDiscipline, isClubCoordinator } from "@/lib/club-access"
import {
  consumeRateLimit,
  getRequestIpHash,
  writeAuditLog,
} from "@/lib/security"

export type { ActionResult } from "@/lib/orders"

// requireClubUser falla sin sesión, con un usuario que no es de club o con la
// contraseña temporal sin cambiar: en los tres casos la salida es volver a entrar.
const SESSION_ERROR =
  "Tu sesión expiró o no tiene acceso a este club. Vuelve a iniciar sesión."

const docNumberSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9-]{4,20}$/,
    "Revisa el N.º de documento: debe tener de 4 a 20 letras, números o guiones."
  )

export type DocumentLookup =
  | { status: "INVALID"; message: string }
  // Ya está en la lista del club: no hay nada que crear.
  | { status: "OWN_CLUB"; athleteId: string; fullName: string; disciplines: string[] }
  // Pertenece a otro club: el traspaso lo resuelve la federación.
  | { status: "OTHER_CLUB" }
  | { status: "AVAILABLE"; docNumber: string }

export async function lookupDocument(rawDocNumber: string): Promise<DocumentLookup> {
  let user: Awaited<ReturnType<typeof requireClubUser>>
  try {
    user = await requireClubUser()
  } catch {
    return { status: "INVALID", message: SESSION_ERROR }
  }

  const parsed = docNumberSchema.safeParse(rawDocNumber)
  if (!parsed.success) {
    return {
      status: "INVALID",
      message: "Revisa el N.º de documento: debe tener de 4 a 20 letras, números o guiones.",
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
    return {
      status: "INVALID",
      message: "Hiciste demasiadas búsquedas seguidas. Espera 5 minutos y vuelve a buscar.",
    }
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
      return {
        status: "OWN_CLUB",
        athleteId: existing.id,
        fullName,
        disciplines: existing.disciplines.map((discipline) => disciplineLabel(discipline)),
      }
    }
    return {
      status: "INVALID",
      message:
        "Este deportista ya está en el padrón de tu club, en una disciplina a la que tu usuario no tiene acceso. Pídele al coordinador del club que lo revise.",
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
  firstNames: z.string().trim().min(1, "Escribe los nombres del deportista."),
  lastNames: z.string().trim().min(1, "Escribe los apellidos del deportista."),
  docType: z.enum(["DNI", "CE", "PASAPORTE", "OTROS"], {
    error: "Elige el tipo de documento.",
  }),
  docNumber: docNumberSchema,
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Escribe la fecha de nacimiento completa."),
  sex: z.enum(["M", "F"], { error: "Elige el sexo del deportista." }),
  disciplines: z
    .array(z.enum(DISCIPLINE_VALUES))
    .min(1, "Marca al menos una disciplina que practique."),
  privacyAccepted: z.literal("on", {
    error: "Confirma que tienes autorización para registrar sus datos personales.",
  }),
})

// Alta directa: el deportista entra al padrón y queda pendiente de afiliación.
// El club sale de la sesión, nunca del formulario. `added` cuenta las cuotas
// que entraron al carrito: sin temporada o sin cuota fijada no entra ninguna,
// y el portal no debe decir lo contrario.
export async function createClubAthlete(
  formData: FormData
): Promise<ActionResult & { added?: number; seasonOpen?: boolean; fullName?: string }> {
  let user: Awaited<ReturnType<typeof requireClubUser>>
  try {
    user = await requireClubUser()
  } catch {
    return { success: false, error: SESSION_ERROR }
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
    return { success: false, error: "Tu usuario no tiene acceso a una de esas disciplinas." }
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
    return {
      success: false,
      error: `Revisa el año de nacimiento: debe estar entre 1900 y ${currentYear}.`,
    }
  }

  const season = await getCurrentSeason()
  // Una cuota por disciplina practicada; las que no tienen tarifa este año
  // quedan sin afiliación hasta que la federación la fije.
  const fees = season ? await getSeasonFees(season.id) : null
  let added = 0

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
          added = billable.length
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
        error: "Ese documento ya está registrado. Vuelve a buscarlo para ver en qué club está.",
      }
    }
    console.error("createClubAthlete error:", error)
    return {
      success: false,
      error: "No pudimos registrar al deportista. Vuelve a intentarlo; tus datos siguen en el formulario.",
    }
  }

  revalidatePath("/deportistas")
  revalidatePath("/afiliacion", "layout")
  revalidatePath("/inicio")
  return {
    success: true,
    added,
    seasonOpen: Boolean(season),
    fullName: `${data.lastNames}, ${data.firstNames}`,
  }
}
