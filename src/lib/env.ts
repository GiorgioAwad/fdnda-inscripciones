const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

// node-postgres 8.x trata `require` como `verify-full`, pero en pg 9 pasará a
// significar "cifra sin verificar el certificado". Aceptar `verify-full` permite
// fijarlo explícitamente en la cadena de conexión antes de esa migración.
const SECURE_SSL_MODES = new Set(["require", "verify-full"])

function isProductionRuntime() {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  )
}

export type DeploymentTier = "production" | "staging"

/**
 * Nivel del despliegue. En plataformas serverless `NODE_ENV` siempre vale
 * "production", así que no distingue el entorno real del de pruebas: hace falta
 * declararlo.
 *
 * Solo el valor exacto "staging" relaja los controles. Cualquier otro valor, y
 * también su ausencia, se tratan como producción: olvidar la variable da el
 * comportamiento estricto, nunca el permisivo.
 */
export function getDeploymentTier(): DeploymentTier {
  return process.env.APP_ENV === "staging" ? "staging" : "production"
}

/** Identifica contra qué base apunta el proceso, sin revelar credenciales. */
export function describeDatabaseTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL || "")
    return `${url.hostname}${url.pathname}`
  } catch {
    return "desconocida"
  }
}

function hasMinimumLength(value: string | undefined, minimum: number) {
  return Boolean(value && value.length >= minimum)
}

export function assertProductionConfiguration(options?: { force?: boolean }): void {
  if (!options?.force && !isProductionRuntime()) return

  const problems: string[] = []
  const isStaging = getDeploymentTier() === "staging"
  const paymentsMode = process.env.PAYMENTS_MODE

  // DIRECT_DATABASE_URL no está aquí a propósito: solo la usan las migraciones
  // (prisma.config.ts), nunca el runtime. Exigirla obligaría a cargar en el
  // hosting las credenciales del rol con permisos de DDL, y eso anularía la
  // separación entre el rol de aplicación y el de migración.
  const required = [
    "DATABASE_URL",
    "AUTH_SECRET",
    "AUTH_TRUST_HOST",
    "NEXT_PUBLIC_APP_URL",
    "MAINTENANCE_SECRET",
    "IP_HASH_SECRET",
    "PRIVACY_CONTACT_EMAIL",
    "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
    // Las credenciales de la pasarela solo hacen falta si se va a cobrar.
    ...(paymentsMode === "izipay"
      ? [
          "IZIPAY_MERCHANT_CODE",
          "IZIPAY_API_KEY",
          "IZIPAY_HASH_KEY",
          "IZIPAY_PUBLIC_KEY",
          "IZIPAY_ENDPOINT",
        ]
      : []),
  ]

  for (const name of required) {
    if (!process.env[name]?.trim()) problems.push(`${name} no está definido`)
  }

  if (isStaging) {
    if (paymentsMode !== "izipay" && paymentsMode !== "mock") {
      problems.push("PAYMENTS_MODE debe ser izipay o mock")
    }
  } else if (paymentsMode !== "izipay") {
    problems.push("PAYMENTS_MODE debe ser izipay")
  }
  if (!hasMinimumLength(process.env.AUTH_SECRET, 32)) {
    problems.push("AUTH_SECRET debe tener al menos 32 caracteres")
  }
  if (!hasMinimumLength(process.env.MAINTENANCE_SECRET, 32)) {
    problems.push("MAINTENANCE_SECRET debe tener al menos 32 caracteres")
  }
  if (!hasMinimumLength(process.env.IP_HASH_SECRET, 32)) {
    problems.push("IP_HASH_SECRET debe tener al menos 32 caracteres")
  }
  if (process.env.AUTH_TRUST_HOST !== "true") {
    problems.push("AUTH_TRUST_HOST debe ser true detrás del proxy de producción")
  }

  const actionsKey = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY || ""
  try {
    if (Buffer.from(actionsKey, "base64").length !== 32) {
      problems.push("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY debe ser Base64 de 32 bytes")
    }
  } catch {
    problems.push("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY no es Base64 válido")
  }

  for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL"] as const) {
    const value = process.env[name]
    if (!value) continue
    try {
      const url = new URL(value)
      if (!url.protocol.startsWith("postgres")) {
        problems.push(`${name} debe ser una URL PostgreSQL`)
      }
      if (LOCAL_HOSTS.has(url.hostname)) problems.push(`${name} no puede apuntar a localhost`)
      const sslmode = url.searchParams.get("sslmode")
      if (!sslmode || !SECURE_SSL_MODES.has(sslmode)) {
        problems.push(`${name} debe exigir sslmode=require o sslmode=verify-full`)
      }
    } catch {
      problems.push(`${name} no es una URL válida`)
    }
  }

  // El sandbox de Izipay solo se admite en staging. En producción cobrar contra
  // el sandbox aceptaría inscripciones reales sin cobro real.
  if (paymentsMode === "izipay") {
    const endpoint = process.env.IZIPAY_ENDPOINT || ""
    if (!endpoint.startsWith("https://")) {
      problems.push("IZIPAY_ENDPOINT debe ser HTTPS")
    } else if (!isStaging && endpoint.toLowerCase().includes("sandbox")) {
      problems.push("IZIPAY_ENDPOINT debe ser HTTPS de producción, no sandbox")
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      const url = new URL(appUrl)
      if (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname)) {
        problems.push("NEXT_PUBLIC_APP_URL debe ser el dominio público HTTPS")
      }
      if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
        problems.push("NEXT_PUBLIC_APP_URL no debe incluir ruta, query ni fragmento")
      }
    } catch {
      problems.push("NEXT_PUBLIC_APP_URL no es una URL válida")
    }
  }

  const privacyEmail = process.env.PRIVACY_CONTACT_EMAIL || ""
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyEmail)) {
    problems.push("PRIVACY_CONTACT_EMAIL no es un correo válido")
  }

  if (problems.length > 0) {
    throw new Error(`Configuración de producción inválida: ${problems.join("; ")}`)
  }
}

export function getCanonicalAppUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")
  if (!value && isProductionRuntime()) {
    throw new Error("NEXT_PUBLIC_APP_URL es obligatorio en producción")
  }
  return value || "http://localhost:3000"
}
