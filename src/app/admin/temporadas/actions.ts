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
      .number({ error: "El año debe estar entre 2000 y 2100." })
      .int("El año debe ser un número entero.")
      .min(2000, "El año debe estar entre 2000 y 2100.")
      .max(2100, "El año debe estar entre 2000 y 2100."),
    name: z.string().trim().min(3, "Escribe el nombre de la temporada."),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha de inicio de la vigencia."),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha de fin de la vigencia."),
  })
  .refine((data) => data.startDate <= data.endDate, {
    error: "La fecha de fin de la vigencia es anterior a la de inicio.",
  })

// Tarifa opcional por disciplina: dejar ambos campos en blanco significa que esa
// disciplina no se afilia esta temporada.
const feeSchema = z.union([
  z.literal(""),
  z.coerce.number().min(0, "Las cuotas no pueden ser negativas."),
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
      return {
        error: `Las cuotas de ${disciplineLabel(discipline)} deben ser montos en soles, de 0 o más.`,
      }
    }
    if (club.data === "" || athlete.data === "") {
      return {
        error: `${disciplineLabel(discipline)} necesita las dos cuotas (del club y por deportista) o ninguna.`,
      }
    }

    fees.push({ discipline, clubFee: club.data, athleteFee: athlete.data })
  }

  return { fees }
}

// `makeCurrent` solo se acepta al crear y cuando no hay otra vigente: la
// pantalla lo ofrece como «Hacerla vigente al crearla».
export async function saveSeason(
  formData: FormData
): Promise<ActionResult & { isCurrent?: boolean }> {
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
      error: "Fija las cuotas de al menos una disciplina.",
    }
  }

  const { id, startDate, endDate, ...data } = parsed.data
  const makeCurrent = !id && formData.get("makeCurrent") === "on"
  let isCurrent = false

  try {
    const payload = {
      ...data,
      startDate: dateFromISO(startDate),
      endDate: dateFromISO(endDate),
    }

    await prisma.$transaction(async (tx) => {
      // Se vuelve a mirar dentro de la transacción: si otro admin hizo vigente
      // una temporada mientras tanto, la nueva se crea sin tocar la vigente.
      const setCurrent =
        makeCurrent && (await tx.season.count({ where: { isCurrent: true } })) === 0
      const season = id
        ? await tx.season.update({ where: { id }, data: payload })
        : await tx.season.create({ data: { ...payload, isCurrent: setCurrent } })
      isCurrent = setCurrent

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
      return {
        success: false,
        error: `Ya existe una temporada ${data.year}. Edítala en vez de crear otra.`,
      }
    }
    console.error("saveSeason error:", error)
    return {
      success: false,
      error: "No se pudo guardar la temporada. Inténtalo de nuevo.",
    }
  }

  revalidatePath("/admin/temporadas")
  if (isCurrent) {
    revalidatePath("/admin/afiliaciones")
    revalidatePath("/admin/padron")
    revalidatePath("/admin/clubes")
  }
  return { success: true, isCurrent }
}

// Solo una temporada puede estar vigente: se apaga el resto en la misma
// transacción para que el portal nunca vea dos.
export async function setCurrentSeason(seasonId: string): Promise<ActionResult> {
  await requireAdmin()

  const season = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!season) {
    return { success: false, error: "Esa temporada ya no existe. Recarga la página." }
  }

  await prisma.$transaction([
    prisma.season.updateMany({
      where: { isCurrent: true, id: { not: seasonId } },
      data: { isCurrent: false },
    }),
    prisma.season.update({ where: { id: seasonId }, data: { isCurrent: true } }),
  ])

  revalidatePath("/admin/temporadas")
  revalidatePath("/admin/afiliaciones")
  revalidatePath("/admin/padron")
  revalidatePath("/admin/clubes")
  return { success: true }
}

const BIRTH_YEAR_ERROR = "Los años de nacimiento deben estar entre 1900 y 2100."
const birthYear = z.coerce
  .number({ error: BIRTH_YEAR_ERROR })
  .int(BIRTH_YEAR_ERROR)
  .min(1900, BIRTH_YEAR_ERROR)
  .max(2100, BIRTH_YEAR_ERROR)

const categorySchema = z
  .object({
    id: z.string().optional(),
    seasonId: z.string().min(1),
    discipline: z.enum(DISCIPLINE_VALUES),
    name: z.string().trim().min(2, "Escribe el nombre de la categoría."),
    birthYearFrom: z
      .union([z.literal(""), birthYear], { error: BIRTH_YEAR_ERROR })
      .optional(),
    birthYearTo: z
      .union([z.literal(""), birthYear], { error: BIRTH_YEAR_ERROR })
      .optional(),
    sortOrder: z.coerce
      .number({ error: "La posición debe ser un número de 0 a 999." })
      .int("La posición debe ser un número entero.")
      .min(0, "La posición debe ser un número de 0 a 999.")
      .max(999, "La posición debe ser un número de 0 a 999.")
      .default(0),
  })
  .refine(
    (data) =>
      data.birthYearFrom === "" ||
      data.birthYearTo === "" ||
      data.birthYearFrom === undefined ||
      data.birthYearTo === undefined ||
      data.birthYearFrom <= data.birthYearTo,
    { error: "«Año desde» debe ser menor o igual que «Año hasta»." }
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
        error: "Esa disciplina ya tiene una categoría con ese nombre. Usa otro.",
      }
    }
    console.error("saveCategory error:", error)
    return {
      success: false,
      error: "No se pudo guardar la categoría. Inténtalo de nuevo.",
    }
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
    return {
      success: false,
      error: "No se pudo eliminar la categoría. Recarga la página e inténtalo de nuevo.",
    }
  }

  revalidatePath("/admin/temporadas")
  return { success: true }
}
