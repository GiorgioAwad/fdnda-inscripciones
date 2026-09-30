"use server"

import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

// Terminar la guía y omitirla valen lo mismo: el usuario ya decidió, y volver
// a mostrársela sería el primer fastidio del producto. Queda a mano en el menú.
export async function markGuideSeenAction(): Promise<void> {
  const user = await getCurrentUser()
  if (!user || user.onboardedAt) return

  await prisma.user.updateMany({
    where: { id: user.id, onboardedAt: null },
    data: { onboardedAt: new Date() },
  })
}
