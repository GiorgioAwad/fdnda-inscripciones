"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hashPassword, requireAdmin } from "@/lib/auth"
import { DISCIPLINE_VALUES, type DisciplineValue } from "@/lib/disciplines"

export interface ActionResult {
  success: boolean
  error?: string
}

const clubSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(3, "El nombre del club debe tener al menos 3 caracteres."),
  code: z
    .string()
    .trim()
    .min(2, "El código debe tener al menos 2 caracteres.")
    .max(20, "El código admite hasta 20 caracteres.")
    .regex(/^[A-Za-z0-9_-]+$/, "El código solo admite letras sin tilde, números y guiones.")
    .transform((v) => v.toUpperCase()),
  region: z.string().trim().max(60, "La región admite hasta 60 caracteres.").optional(),
  contactName: z
    .string()
    .trim()
    .max(80, "El nombre del contacto admite hasta 80 caracteres.")
    .optional(),
  contactPhone: z
    .string()
    .trim()
    .max(20, "El teléfono admite hasta 20 caracteres.")
    .optional(),
  contactEmail: z
    .string()
    .trim()
    .max(80, "El correo admite hasta 80 caracteres.")
    .refine(
      (v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
      "Revisa el correo electrónico: le falta la @ o el dominio."
    )
    .optional(),
})

// Devuelve el club guardado para que la pantalla pueda seguir con el paso
// siguiente (crear su usuario de acceso) sin volver a buscarlo.
export async function saveClub(
  formData: FormData
): Promise<ActionResult & { club?: { id: string; name: string; code: string; contactName: string } }> {
  await requireAdmin()

  const parsed = clubSchema.safeParse({
    id: String(formData.get("id") ?? "") || undefined,
    name: formData.get("name"),
    code: formData.get("code"),
    region: String(formData.get("region") ?? ""),
    contactName: String(formData.get("contactName") ?? ""),
    contactPhone: String(formData.get("contactPhone") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const { id, ...data } = parsed.data

  let saved
  try {
    saved = id
      ? await prisma.club.update({ where: { id }, data })
      : await prisma.club.create({ data })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: "Ya hay un club con ese nombre o ese código. Cambia uno de los dos.",
      }
    }
    console.error("saveClub error:", error)
    return {
      success: false,
      error: "No se pudieron guardar los datos del club. Inténtalo de nuevo.",
    }
  }

  revalidatePath("/admin/clubes")
  return {
    success: true,
    club: {
      id: saved.id,
      name: saved.name,
      code: saved.code,
      contactName: saved.contactName ?? "",
    },
  }
}

// Estado explícito, no un conmutador: la pantalla confirma «Desactivar» y el
// servidor aplica exactamente eso aunque otro admin lo haya cambiado entretanto.
export async function setClubActive(
  clubId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin()

  const club = await prisma.club.findUnique({ where: { id: clubId } })
  if (!club) return { success: false, error: "Ese club ya no existe. Recarga la página." }

  await prisma.club.update({
    where: { id: clubId },
    data: { isActive },
  })

  revalidatePath("/admin/clubes")
  revalidatePath("/admin/afiliaciones")
  return { success: true }
}

// Una sola opción: "" = coordinador del club (ve todo), o una disciplina.
function parseDisciplineAccess(
  value: FormDataEntryValue | null
): { ok: true; access: DisciplineValue[] } | { ok: false } {
  const raw = String(value ?? "")
  if (raw === "") return { ok: true, access: [] }
  const discipline = DISCIPLINE_VALUES.find((item) => item === raw)
  return discipline ? { ok: true, access: [discipline] } : { ok: false }
}

const userSchema = z.object({
  clubId: z.string().min(1),
  username: z
    .string()
    .trim()
    .min(3, "El usuario debe tener al menos 3 caracteres.")
    .max(30, "El usuario admite hasta 30 caracteres.")
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "El usuario solo admite letras sin tilde, números, punto y guiones."
    )
    .transform((v) => v.toLowerCase()),
  name: z.string().trim().min(3, "Escribe el nombre de quien usará este usuario."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
})

export async function createClubUser(
  formData: FormData
): Promise<ActionResult & { username?: string }> {
  await requireAdmin()

  const parsed = userSchema.safeParse({
    clubId: formData.get("clubId"),
    username: formData.get("username"),
    name: formData.get("name"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const access = parseDisciplineAccess(formData.get("disciplineAccess"))
  if (!access.ok) {
    return { success: false, error: "Elige qué puede ver este usuario." }
  }

  const club = await prisma.club.findUnique({ where: { id: parsed.data.clubId } })
  if (!club) return { success: false, error: "Ese club ya no existe. Recarga la página." }

  try {
    await prisma.user.create({
      data: {
        username: parsed.data.username,
        name: parsed.data.name,
        passwordHash: await hashPassword(parsed.data.password),
        role: "CLUB",
        clubId: club.id,
        disciplineAccess: access.access,
        mustChangePassword: true,
      },
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: `El usuario «${parsed.data.username}» ya existe. Elige otro.`,
      }
    }
    console.error("createClubUser error:", error)
    return {
      success: false,
      error: "No se pudo crear el usuario de acceso. Inténtalo de nuevo.",
    }
  }

  revalidatePath("/admin/clubes")
  return { success: true, username: parsed.data.username }
}

export async function saveClubUserAccess(formData: FormData): Promise<ActionResult> {
  await requireAdmin()

  const userId = String(formData.get("userId") ?? "")
  const access = parseDisciplineAccess(formData.get("disciplineAccess"))
  if (!userId || !access.ok) {
    return { success: false, error: "Elige qué puede ver este usuario." }
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || user.role !== "CLUB") {
    return { success: false, error: "Ese usuario de acceso ya no existe. Recarga la página." }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      disciplineAccess: access.access,
      sessionVersion: { increment: 1 },
    },
  })
  revalidatePath("/admin/clubes")
  return { success: true }
}

export async function resetClubUserPassword(formData: FormData): Promise<ActionResult> {
  await requireAdmin()

  const userId = String(formData.get("userId") ?? "")
  const password = String(formData.get("password") ?? "")

  if (!userId) {
    return { success: false, error: "Ese usuario de acceso ya no existe. Recarga la página." }
  }
  if (password.length < 8) {
    return { success: false, error: "La contraseña debe tener al menos 8 caracteres." }
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || user.role !== "CLUB") {
    return { success: false, error: "Ese usuario de acceso ya no existe. Recarga la página." }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      sessionVersion: { increment: 1 },
    },
  })

  revalidatePath("/admin/clubes")
  return { success: true }
}

// Estado explícito por la misma razón que setClubActive.
export async function setClubUserActive(
  userId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin()

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || user.role !== "CLUB") {
    return { success: false, error: "Ese usuario de acceso ya no existe. Recarga la página." }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      isActive,
      sessionVersion: { increment: 1 },
    },
  })

  revalidatePath("/admin/clubes")
  return { success: true }
}
