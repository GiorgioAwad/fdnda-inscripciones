"use server"

import { revalidatePath } from "next/cache"
import { requireClubUser } from "@/lib/auth"
import { saveEventEntries, type EntryInput } from "@/lib/event-entries"
import type { ActionResult } from "@/lib/registrations"
import {
  assertAthletesAccess,
  assertEventAccess,
  assertModalityAccess,
} from "@/lib/club-access"

// Guarda la planilla completa del club para un evento: reemplaza lo que tenía en
// el carrito de ese evento por lo que quedó en pantalla. Todo se revalida en el
// servidor (afiliación, elegibilidad, composición, cupo): la pantalla solo
// adelanta el mismo veredicto.
export async function saveEntriesAction(input: {
  eventId: string
  entries: EntryInput[]
}): Promise<ActionResult & { saved?: number }> {
  let user: Awaited<ReturnType<typeof requireClubUser>>
  try {
    user = await requireClubUser()
    await assertEventAccess(user, input.eventId)
    await Promise.all(
      input.entries.map((entry) => assertModalityAccess(user, entry.modalityId))
    )
    await assertAthletesAccess(
      user,
      input.entries.flatMap((entry) => [
        ...entry.athleteIds,
        ...(entry.reserveIds ?? []),
      ])
    )
  } catch {
    return {
      success: false,
      error: "Solo los usuarios de club pueden inscribir deportistas.",
    }
  }

  const result = await saveEventEntries({
    clubId: user.clubId,
    eventId: input.eventId,
    entries: input.entries,
  })

  if (result.success) {
    revalidatePath("/carrito")
    revalidatePath("/eventos", "layout")
  }

  return result
}
