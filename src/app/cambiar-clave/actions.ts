"use server"

import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hashPassword, signOut } from "@/lib/auth"
import { consumeRateLimit, getRequestIpHash, writeAuditLog } from "@/lib/security"

export type PasswordChangeState = { error?: string }

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(12, "Usa al menos 12 caracteres.")
      .max(128)
      .regex(/[a-z]/, "Incluye una minúscula.")
      .regex(/[A-Z]/, "Incluye una mayúscula.")
      .regex(/[0-9]/, "Incluye un número.")
      .regex(/[^A-Za-z0-9]/, "Incluye un símbolo."),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas nuevas no coinciden.",
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ["newPassword"],
    message: "La nueva contraseña debe ser diferente.",
  })

export async function changePasswordAction(
  _previous: PasswordChangeState,
  formData: FormData
): Promise<PasswordChangeState> {
  const user = await getCurrentUser()
  if (!user) return { error: "La sesión expiró. Vuelve a iniciar sesión." }

  const limit = await consumeRateLimit({
    namespace: "password-change",
    identity: user.id,
    limit: 5,
    windowSeconds: 15 * 60,
    blockSeconds: 15 * 60,
  })
  if (!limit.allowed) {
    return { error: "Demasiados intentos. Espera 15 minutos." }
  }

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  })
  const ipHash = await getRequestIpHash()
  if (!account || !(await bcrypt.compare(parsed.data.currentPassword, account.passwordHash))) {
    await writeAuditLog({
      actorId: user.id,
      actorRole: user.role,
      action: "auth.password_change_failed",
      success: false,
      ipHash,
    })
    return { error: "La contraseña actual no es correcta." }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
      sessionVersion: { increment: 1 },
    },
  })
  await writeAuditLog({
    actorId: user.id,
    actorRole: user.role,
    action: "auth.password_changed",
    ipHash,
  })

  await signOut({ redirectTo: "/login?passwordChanged=1" })
  return {}
}
