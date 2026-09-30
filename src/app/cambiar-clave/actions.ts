"use server"

import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hashPassword, signOut } from "@/lib/auth"
import { consumeRateLimit, getRequestIpHash, writeAuditLog } from "@/lib/security"

// `errors` lista TODAS las reglas incumplidas de una vez: antes se mostraba
// solo la primera y había que reintentar una por una.
export type PasswordChangeState = { error?: string; errors?: string[] }

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Escribe tu contraseña actual."),
  newPassword: z
    .string()
    .min(12, "Usa al menos 12 caracteres.")
    .max(128, "Usa como máximo 128 caracteres.")
    .regex(/[a-z]/, "Incluye una minúscula.")
    .regex(/[A-Z]/, "Incluye una mayúscula.")
    .regex(/[0-9]/, "Incluye un número.")
    .regex(/[^A-Za-z0-9]/, "Incluye un símbolo."),
  confirmPassword: z.string(),
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
    return { error: "Demasiados intentos seguidos. Espera 15 minutos y vuelve a intentarlo." }
  }

  const raw = {
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  }
  const parsed = passwordSchema.safeParse(raw)
  const errors = parsed.success
    ? []
    : [...new Set(parsed.error.issues.map((issue) => issue.message))]
  if (raw.newPassword !== raw.confirmPassword) {
    errors.push("Las dos contraseñas nuevas no coinciden.")
  }
  if (raw.newPassword && raw.newPassword === raw.currentPassword) {
    errors.push("La nueva contraseña debe ser distinta de la actual.")
  }
  if (!parsed.success || errors.length > 0) return { errors }

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
