"use server"

import { AuthError } from "next-auth"
import { signIn } from "@/lib/auth"
import {
  consumeRateLimit,
  getRequestIpHash,
  writeAuditLog,
} from "@/lib/security"

export interface LoginState {
  error?: string
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const callbackUrl = String(formData.get("callbackUrl") ?? "")

  if (!username || !password) {
    return { error: "Ingresa tu usuario y contraseña." }
  }

  const ipHash = await getRequestIpHash()
  const [ipLimit, userLimit] = await Promise.all([
    consumeRateLimit({
      namespace: "login-ip",
      identity: ipHash,
      limit: 20,
      windowSeconds: 15 * 60,
      blockSeconds: 15 * 60,
    }),
    consumeRateLimit({
      namespace: "login-user",
      identity: username,
      limit: 10,
      windowSeconds: 15 * 60,
      blockSeconds: 15 * 60,
    }),
  ])
  if (!ipLimit.allowed || !userLimit.allowed) {
    await writeAuditLog({
      action: "auth.login_rate_limited",
      success: false,
      ipHash,
    })
    return {
      error: "Demasiados intentos. Espera unos minutos antes de volver a intentar.",
    }
  }

  try {
    await signIn("credentials", {
      username,
      password,
      redirectTo: callbackUrl || "/",
    })
    return {}
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Usuario o contraseña incorrectos." }
    }
    // signIn lanza NEXT_REDIRECT en el flujo exitoso: debe propagarse.
    throw error
  }
}
