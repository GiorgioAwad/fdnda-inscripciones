"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hashPassword, requireAdmin } from "@/lib/auth"
import { DISCIPLINE_VALUES } from "@/lib/disciplines"

export interface ActionResult {
  success: boolean
  error?: string
}

const clubSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(3, "El nombre debe tener al menos 3 caracteres"),
  code: z
    .string()
    .trim()
    .min(2, "El código debe tener al menos 2 caracteres")
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "El código solo admite letras, números y guiones")
    .transform((v) => v.toUpperCase()),
  region: z.string().trim().max(60).optional(),
  contactName: z.string().trim().max(80).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  contactEmail: z
    .string()
    .trim()
    .max(80)
    .refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Email inválido")
    .optional(),
})

export async function saveClub(formData: FormData): Promise<ActionResult> {
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

  try {
    if (id) {
      await prisma.club.update({ where: { id }, data })
    } else {
      await prisma.club.create({ data })
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "Ya existe un club con ese nombre o código." }
    }
    console.error("saveClub error:", error)
    return { success: false, error: "No se pudo guardar el club." }
  }

  revalidatePath("/admin/clubes")
  return { success: true }
}

export async function toggleClubActive(clubId: string): Promise<ActionResult> {
  await requireAdmin()

  const club = await prisma.club.findUnique({ where: { id: clubId } })
  if (!club) return { success: false, error: "Club no encontrado." }

  await prisma.club.update({
    where: { id: clubId },
    data: { isActive: !club.isActive },
  })

  revalidatePath("/admin/clubes")
  return { success: true }
}

const userSchema = z.object({
  clubId: z.string().min(1),
  username: z
    .string()
    .trim()
    .min(3, "El usuario debe tener al menos 3 caracteres")
    .max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "El usuario solo admite letras, números, punto y guiones")
    .transform((v) => v.toLowerCase()),
  name: z.string().trim().min(3, "Ingresa el nombre del delegado"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  disciplineAccess: z.array(z.enum(DISCIPLINE_VALUES)).max(1),
})

export async function createClubUser(formData: FormData): Promise<ActionResult> {
  await requireAdmin()

  const parsed = userSchema.safeParse({
    clubId: formData.get("clubId"),
    username: formData.get("username"),
    name: formData.get("name"),
    password: formData.get("password"),
    disciplineAccess: formData.getAll("disciplineAccess").map(String),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const club = await prisma.club.findUnique({ where: { id: parsed.data.clubId } })
  if (!club) return { success: false, error: "Club no encontrado." }

  try {
    await prisma.user.create({
      data: {
        username: parsed.data.username,
        name: parsed.data.name,
        passwordHash: await hashPassword(parsed.data.password),
        role: "CLUB",
        clubId: club.id,
        disciplineAccess: parsed.data.disciplineAccess,
        mustChangePassword: true,
      },
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "Ese nombre de usuario ya está en uso." }
    }
    console.error("createClubUser error:", error)
    return { success: false, error: "No se pudo crear el usuario." }
  }

  revalidatePath("/admin/clubes")
  return { success: true }
}

const accessSchema = z.object({
  userId: z.string().min(1),
  disciplineAccess: z.array(z.enum(DISCIPLINE_VALUES)).max(1),
})

export async function saveClubUserAccess(formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const parsed = accessSchema.safeParse({
    userId: formData.get("userId"),
    disciplineAccess: formData.getAll("disciplineAccess").map(String),
  })
  if (!parsed.success) return { success: false, error: "Alcance inválido." }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } })
  if (!user || user.role !== "CLUB") {
    return { success: false, error: "Usuario no encontrado." }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      disciplineAccess: parsed.data.disciplineAccess,
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

  if (!userId) return { success: false, error: "Usuario inválido." }
  if (password.length < 8) {
    return { success: false, error: "La contraseña debe tener al menos 8 caracteres." }
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || user.role !== "CLUB") {
    return { success: false, error: "Usuario no encontrado." }
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

export async function toggleClubUserActive(userId: string): Promise<ActionResult> {
  await requireAdmin()

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || user.role !== "CLUB") {
    return { success: false, error: "Usuario no encontrado." }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: !user.isActive,
      sessionVersion: { increment: 1 },
    },
  })

  revalidatePath("/admin/clubes")
  return { success: true }
}
