import "server-only"

import crypto from "node:crypto"
import { headers } from "next/headers"
import { Prisma } from "@prisma/client"
import { prisma } from "./prisma"

function securitySecret(): string {
  const value = process.env.IP_HASH_SECRET || process.env.AUTH_SECRET
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("IP_HASH_SECRET es obligatorio en producción")
    }
    return "fdnda-development-only-security-secret"
  }
  return value
}

function keyedHash(value: string): string {
  return crypto.createHmac("sha256", securitySecret()).update(value).digest("hex")
}

export async function getRequestIpHash(): Promise<string> {
  const requestHeaders = await headers()
  // Los proxies administrados añaden el cliente al final de la cadena. Usar el
  // primer valor permitiría que un cliente antepusiera una IP falsa.
  const forwarded = requestHeaders
    .get("x-forwarded-for")
    ?.split(",")
    .at(-1)
    ?.trim()
  const ip = forwarded || requestHeaders.get("x-real-ip") || "unknown"
  return keyedHash(`ip:${ip}`)
}

export async function consumeRateLimit(input: {
  namespace: string
  identity: string
  limit: number
  windowSeconds: number
  blockSeconds: number
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = new Date()
  const windowBoundary = new Date(now.getTime() - input.windowSeconds * 1000)
  const nextBlockedUntil = new Date(now.getTime() + input.blockSeconds * 1000)
  const key = keyedHash(`${input.namespace}:${input.identity.toLowerCase()}`)

  const rows = await prisma.$queryRaw<
    Array<{ count: number; blockedUntil: Date | null }>
  >(Prisma.sql`
    INSERT INTO "security_rate_limits"
      ("key", "count", "windowStartedAt", "blockedUntil", "updatedAt")
    VALUES
      (${key}, 1, ${now}, NULL, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "security_rate_limits"."windowStartedAt" <= ${windowBoundary} THEN 1
        ELSE "security_rate_limits"."count" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "security_rate_limits"."windowStartedAt" <= ${windowBoundary} THEN ${now}
        ELSE "security_rate_limits"."windowStartedAt"
      END,
      "blockedUntil" = CASE
        WHEN "security_rate_limits"."blockedUntil" > ${now}
          THEN "security_rate_limits"."blockedUntil"
        WHEN (
          CASE
            WHEN "security_rate_limits"."windowStartedAt" <= ${windowBoundary} THEN 1
            ELSE "security_rate_limits"."count" + 1
          END
        ) > ${input.limit}
          THEN ${nextBlockedUntil}
        ELSE NULL
      END,
      "updatedAt" = ${now}
    RETURNING "count", "blockedUntil"
  `)

  const blockedUntil = rows[0]?.blockedUntil
  const retryAfterSeconds = blockedUntil
    ? Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000))
    : 0
  return { allowed: retryAfterSeconds === 0, retryAfterSeconds }
}

export async function pruneSecurityRateLimits(retentionHours = 48): Promise<number> {
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
  const deleted = await prisma.securityRateLimit.deleteMany({
    where: {
      updatedAt: { lt: cutoff },
      OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }],
    },
  })
  return deleted.count
}

export async function writeAuditLog(input: {
  actorId?: string | null
  actorRole?: string | null
  action: string
  targetType?: string
  targetId?: string
  success?: boolean
  ipHash?: string
  metadata?: Record<string, string | number | boolean | null>
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        success: input.success ?? true,
        ipHash: input.ipHash,
        metadata: input.metadata,
      },
    })
  } catch (error) {
    console.error("No se pudo escribir el registro de auditoría", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
