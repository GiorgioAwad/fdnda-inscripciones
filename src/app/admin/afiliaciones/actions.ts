"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { disciplineLabel, type DisciplineValue } from "@/lib/disciplines"
import type { ActionResult } from "@/lib/orders"

export type { ActionResult } from "@/lib/orders"

// La federación también recibe depósitos fuera de la pasarela: esto regulariza
// una afiliación pendiente sin pasar por Izipay.
export async function markAffiliationPaid(input: {
  kind: "CLUB" | "ATHLETE"
  affiliationId: string
}): Promise<ActionResult> {
  await requireAdmin()

  const where = { id: input.affiliationId, status: "PENDING" as const }
  const data = { status: "ACTIVE" as const, paidAt: new Date(), activeOrderId: null }

  const updated =
    input.kind === "CLUB"
      ? await prisma.clubAffiliation.updateMany({ where, data })
      : await prisma.athleteAffiliation.updateMany({ where, data })

  if (updated.count === 0) {
    return { success: false, error: "Esa afiliación ya no está pendiente." }
  }

  revalidatePath("/admin/afiliaciones")
  revalidatePath("/admin/clubes")
  return { success: true }
}

// Genera la afiliación pendiente del club en UNA disciplina para la temporada
// vigente, para que la federación pueda registrarle un pago recibido por fuera.
export async function createPendingClubAffiliation(
  clubId: string,
  discipline: DisciplineValue
): Promise<ActionResult> {
  await requireAdmin()

  const season = await prisma.season.findFirst({ where: { isCurrent: true } })
  if (!season) {
    return { success: false, error: "No hay una temporada vigente." }
  }

  const fee = await prisma.seasonFee.findUnique({
    where: { seasonId_discipline: { seasonId: season.id, discipline } },
  })
  if (!fee) {
    return {
      success: false,
      error: `La temporada ${season.year} no tiene cuota fijada para ${disciplineLabel(discipline)}.`,
    }
  }

  const existing = await prisma.clubAffiliation.findUnique({
    where: {
      clubId_seasonId_discipline: { clubId, seasonId: season.id, discipline },
    },
  })
  if (existing) {
    return {
      success: false,
      error: `El club ya tiene una afiliación de ${disciplineLabel(discipline)} para la temporada.`,
    }
  }

  await prisma.clubAffiliation.create({
    data: {
      clubId,
      seasonId: season.id,
      discipline,
      fee: fee.clubFee,
      validFrom: season.startDate,
      validTo: season.endDate,
    },
  })

  revalidatePath("/admin/afiliaciones")
  return { success: true }
}
