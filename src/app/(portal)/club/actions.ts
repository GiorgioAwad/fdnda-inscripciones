"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireClubUser } from "@/lib/auth"
import type { ActionResult } from "@/lib/orders"
import { isClubCoordinator } from "@/lib/club-access"

export type { ActionResult } from "@/lib/orders"

// El delegado solo edita los datos de contacto: nombre, código y región los
// administra la federación.
const contactSchema = z.object({
  contactName: z.string().trim().max(80, "Acorta el nombre de contacto a 80 caracteres."),
  contactPhone: z.string().trim().max(20, "Acorta el teléfono a 20 caracteres."),
  contactEmail: z
    .string()
    .trim()
    .max(80, "Acorta el correo electrónico a 80 caracteres.")
    .refine(
      (value) => value === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
      "Revisa el correo electrónico: falta la @ o el dominio."
    ),
})

export async function updateClubContact(formData: FormData): Promise<ActionResult> {
  let clubId: string
  try {
    const user = await requireClubUser()
    if (!isClubCoordinator(user)) {
      return {
        success: false,
        error: "Solo el coordinador del club puede editar el contacto.",
      }
    }
    clubId = user.clubId
  } catch {
    return {
      success: false,
      error: "Tu sesión expiró o no tiene acceso a este club. Vuelve a iniciar sesión.",
    }
  }

  const parsed = contactSchema.safeParse({
    contactName: String(formData.get("contactName") ?? ""),
    contactPhone: String(formData.get("contactPhone") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  await prisma.club.update({
    where: { id: clubId },
    data: {
      contactName: parsed.data.contactName || null,
      contactPhone: parsed.data.contactPhone || null,
      contactEmail: parsed.data.contactEmail || null,
    },
  })

  revalidatePath("/club")
  return { success: true }
}
