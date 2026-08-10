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
  contactName: z.string().trim().max(80),
  contactPhone: z.string().trim().max(20),
  contactEmail: z
    .string()
    .trim()
    .max(80)
    .refine(
      (value) => value === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
      "Email inválido"
    ),
})

export async function updateClubContact(formData: FormData): Promise<ActionResult> {
  let clubId: string
  try {
    const user = await requireClubUser()
    if (!isClubCoordinator(user)) {
      return {
        success: false,
        error: "Solo el coordinador general puede editar los datos compartidos del club.",
      }
    }
    clubId = user.clubId
  } catch {
    return { success: false, error: "No autorizado." }
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
