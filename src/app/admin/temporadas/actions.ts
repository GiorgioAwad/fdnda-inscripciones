"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { DISCIPLINE_VALUES, disciplineLabel } from "@/lib/disciplines"
import type { ActionResult } from "@/lib/orders"

export type { ActionResult } from "@/lib/orders"

const seasonSchema = z
  .object({
    id: z.string().optional(),
    year: z.coerce
      .number()
      .int()
      .min(2000, "Año inválido")
      .max(2100, "Año inválido"),
    name: z.string().trim().min(3, "Ingresa el nombre de la temporada"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de inicio inválida"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de fin inválida"),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: "La vigencia termina antes de empezar",
  })

// Tarifa opcional por disciplina: dejar ambos campos en blanco significa que esa
// disciplina no se afilia esta temporada.
const feeSchema = z.union([
  z.literal(""),
  z.coerce.number().min(0, "Las cuotas no pueden ser negativas"),
])

function dateFromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

interface ParsedFee {
  discipline: (typeof DISCIPLINE_VALUES)[number]
  clubFee: number
  athleteFee: number
}

// Lee del formulario un par de cuotas por disciplina ("clubFee.DIVING", …).
function parseFees(
  formData: FormData
): { fees: ParsedFee[] } | { error: string } {
  const fees: ParsedFee[] = []

  for (const discipline of DISCIPLINE_VALUES) {
    const rawClub = String(formData.get(`clubFee.${discipline}`) ?? "").trim()
    const rawAthlete = String(formData.get(`athleteFee.${discipline}`) ?? "").trim()

    if (rawClub === "" && rawAthlete === "") continue

    const club = feeSchema.safeParse(rawClub)
    const athlete = feeSchema.safeParse(rawAthlete)

    if (!club.success || !athlete.success) {
      return { error: `Revisa las cuotas de ${disciplineLabel(discipline)}.` }
    }
    if (club.data === "" || athlete.data === "") {
      return {
        error: `${disciplineLabel(discipline)} necesita las dos cuotas (club y deportista) o ninguna.`,
      }
    }

    fees.push({ discipline, clubFee: club.data, athleteFee: athlete.data })
  }

  return { fees }
}

export async function saveSeason(formData: FormData): Promise<ActionResult> {
  await requireAdmin()

  const parsed = seasonSchema.safeParse({
    id: String(formData.get("id") ?? "") || undefined,
    year: formData.get("year"),
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const feeResult = parseFees(formData)
  if ("error" in feeResult) {
    return { success: false, error: feeResult.error }
  }
  if (feeResult.fees.length === 0) {
    return {
      success: false,
      error: "Fija la cuota de al menos una disciplina.",
    }
  }

  const { id, startDate, endDate, ...data } = parsed.data

  try {
    const payload = {
      ...data,
      startDate: dateFromISO(startDate),
      endDate: dateFromISO(endDate),
    }

    await prisma.$transaction(async (tx) => {
      const season = id
        ? await tx.season.update({ where: { id }, data: payload })
        : await tx.season.create({ data: payload })

      // Las cuotas ya emitidas guardan su snapshot en cada afiliación: cambiar
      // el tarifario acá no altera lo que un club ya pagó.
      for (const fee of feeResult.fees) {
        await tx.seasonFee.upsert({
          where: {
            seasonId_discipline: {
              seasonId: season.id,
              discipline: fee.discipline,
            },
          },
          create: { seasonId: season.id, ...fee },
          update: { clubFee: fee.clubFee, athleteFee: fee.athleteFee },
        })
      }

      // Una disciplina que se dejó en blanco deja de ofrecerse; solo se puede
      // quitar si nadie la afilió todavía.
      const keep = feeResult.fees.map((fee) => fee.discipline)
      await tx.seasonFee.deleteMany({
        where: { seasonId: season.id, discipline: { notIn: keep } },
      })
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "Ya existe una temporada para ese año." }
    }
    console.error("saveSeason error:", error)
    return { success: false, error: "No se pudo guardar la temporada." }
  }

  revalidatePath("/admin/temporadas")
  return { success: true }
}

// Solo una temporada puede estar vigente: se apaga el resto en la misma
// transacción para que el portal nunca vea dos.
export async function setCurrentSeason(seasonId: string): Promise<ActionResult> {
  await requireAdmin()

  const season = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!season) return { success: false, error: "Temporada no encontrada." }

  await prisma.$transaction([
    prisma.season.updateMany({
      where: { isCurrent: true, id: { not: seasonId } },
      data: { isCurrent: false },
    }),
    prisma.season.update({ where: { id: seasonId }, data: { isCurrent: true } }),
  ])

  revalidatePath("/admin/temporadas")
  revalidatePath("/admin/afiliaciones")
  return { success: true }
}

const categorySchema = z
  .object({
    id: z.string().optional(),
    seasonId: z.string().min(1),
    discipline: z.enum(DISCIPLINE_VALUES),
    name: z.string().trim().min(2, "Ingresa el nombre de la categoría"),
    birthYearFrom: z
      .union([z.coerce.number().int().min(1900).max(2100), z.literal("")])
      .optional(),
    birthYearTo: z
      .union([z.coerce.number().int().min(1900).max(2100), z.literal("")])
      .optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  })
  .refine(
    (data) =>
      data.birthYearFrom === "" ||
      data.birthYearTo === "" ||
      data.birthYearFrom === undefined ||
      data.birthYearTo === undefined ||
      data.birthYearFrom <= data.birthYearTo,
    { message: "El año inicial debe ser menor o igual al final" }
  )

export async function saveCategory(formData: FormData): Promise<ActionResult> {
  await requireAdmin()

  const parsed = categorySchema.safeParse({
    id: String(formData.get("id") ?? "") || undefined,
    seasonId: formData.get("seasonId"),
    discipline: formData.get("discipline"),
    name: formData.get("name"),
    birthYearFrom: String(formData.get("birthYearFrom") ?? ""),
    birthYearTo: String(formData.get("birthYearTo") ?? ""),
    sortOrder: String(formData.get("sortOrder") ?? "0") || "0",
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const { id, birthYearFrom, birthYearTo, ...data } = parsed.data

  const payload = {
    ...data,
    birthYearFrom: birthYearFrom === "" || birthYearFrom === undefined ? null : birthYearFrom,
    birthYearTo: birthYearTo === "" || birthYearTo === undefined ? null : birthYearTo,
  }

  try {
    if (id) {
      await prisma.category.update({ where: { id }, data: payload })
    } else {
      await prisma.category.create({ data: payload })
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: "Ya existe una categoría con ese nombre en esa disciplina.",
      }
    }
    console.error("saveCategory error:", error)
    return { success: false, error: "No se pudo guardar la categoría." }
  }

  revalidatePath("/admin/temporadas")
  return { success: true }
}

export async function deleteCategory(categoryId: string): Promise<ActionResult> {
  await requireAdmin()

  try {
    await prisma.category.delete({ where: { id: categoryId } })
  } catch (error) {
    console.error("deleteCategory error:", error)
    return { success: false, error: "No se pudo eliminar la categoría." }
  }

  revalidatePath("/admin/temporadas")
  return { success: true }
}
