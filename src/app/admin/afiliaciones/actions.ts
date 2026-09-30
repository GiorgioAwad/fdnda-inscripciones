"use server"

import { revalidatePath } from "next/cache"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { todayInLima } from "@/lib/affiliations"
import { disciplineLabel, isDiscipline } from "@/lib/disciplines"
import { getRequestIpHash, writeAuditLog } from "@/lib/security"
import { formatDateOnly, toAmount } from "@/lib/utils"
import type { ActionResult } from "@/lib/orders"

export type { ActionResult } from "@/lib/orders"

// La federación también recibe depósitos fuera de la pasarela. Antes eran dos
// pasos sueltos («Generar cuota» y luego «Marcar pagada») sin registro de quién
// lo hizo; ahora es una sola operación: crea la afiliación si falta, la deja
// pagada y lo anota en la auditoría.
export async function registerExternalClubPayment(input: {
  clubId: string
  discipline: string
}): Promise<ActionResult & { validToISO?: string }> {
  const admin = await requireAdmin()

  if (!isDiscipline(input.discipline)) {
    return { success: false, error: "Esa disciplina no existe. Recarga la página." }
  }
  const discipline = input.discipline
  const label = disciplineLabel(discipline)

  const season = await prisma.season.findFirst({ where: { isCurrent: true } })
  if (!season) {
    return {
      success: false,
      error: "No hay una temporada vigente. Haz vigente una en Temporadas y cuotas.",
    }
  }

  const club = await prisma.club.findUnique({
    where: { id: input.clubId },
    select: { id: true, name: true },
  })
  if (!club) return { success: false, error: "Ese club ya no existe. Recarga la página." }

  const today = todayInLima()
  const paidAt = new Date()

  let result:
    | { ok: true; affiliationId: string; fee: number; validTo: Date; created: boolean; clearedOrderId: string | null }
    | { ok: false; error: string }

  try {
    result = await prisma.$transaction(async (tx) => {
      const existing = await tx.clubAffiliation.findUnique({
        where: {
          clubId_seasonId_discipline: { clubId: club.id, seasonId: season.id, discipline },
        },
      })

      if (existing) {
        if (existing.status === "ACTIVE") {
          return {
            ok: false as const,
            error: `${club.name} ya tiene pagada la afiliación de ${label} de la temporada ${season.year}.`,
          }
        }
        if (existing.validTo < today) {
          return {
            ok: false as const,
            error: `La vigencia de esa afiliación terminó el ${formatDateOnly(existing.validTo)}: ya no se puede registrar su pago.`,
          }
        }
        const updated = await tx.clubAffiliation.updateMany({
          where: { id: existing.id, status: "PENDING" },
          data: { status: "ACTIVE", paidAt, activeOrderId: null },
        })
        if (updated.count === 0) {
          return {
            ok: false as const,
            error: "Esa afiliación acaba de cambiar. Recarga la página y revisa su estado.",
          }
        }
        return {
          ok: true as const,
          affiliationId: existing.id,
          fee: toAmount(existing.fee),
          validTo: existing.validTo,
          created: false,
          clearedOrderId: existing.activeOrderId,
        }
      }

      const fee = await tx.seasonFee.findUnique({
        where: { seasonId_discipline: { seasonId: season.id, discipline } },
      })
      if (!fee) {
        return {
          ok: false as const,
          error: `La temporada ${season.year} no tiene cuota de afiliación de ${label}. Fíjala en Temporadas y cuotas.`,
        }
      }
      if (season.endDate < today) {
        return {
          ok: false as const,
          error: `La vigencia de la temporada ${season.year} ya terminó: no se puede registrar el pago.`,
        }
      }

      const created = await tx.clubAffiliation.create({
        data: {
          clubId: club.id,
          seasonId: season.id,
          discipline,
          status: "ACTIVE",
          paidAt,
          fee: fee.clubFee,
          validFrom: season.startDate,
          validTo: season.endDate,
        },
      })
      return {
        ok: true as const,
        affiliationId: created.id,
        fee: toAmount(created.fee),
        validTo: created.validTo,
        created: true,
        clearedOrderId: null,
      }
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: "Otra persona acaba de registrar esta afiliación. Recarga la página y revisa su estado.",
      }
    }
    console.error("registerExternalClubPayment error:", error)
    return {
      success: false,
      error: "No se pudo registrar el pago. Inténtalo de nuevo.",
    }
  }

  if (!result.ok) return { success: false, error: result.error }

  await writeAuditLog({
    actorId: admin.id,
    actorRole: admin.role,
    action: "club_affiliation.external_payment",
    targetType: "ClubAffiliation",
    targetId: result.affiliationId,
    ipHash: await getRequestIpHash(),
    metadata: {
      clubId: club.id,
      seasonId: season.id,
      discipline,
      fee: result.fee,
      createdAffiliation: result.created,
      clearedOrderId: result.clearedOrderId,
    },
  })

  revalidatePath("/admin/afiliaciones")
  revalidatePath("/admin/clubes")
  revalidatePath("/admin")
  return { success: true, validToISO: result.validTo.toISOString() }
}
