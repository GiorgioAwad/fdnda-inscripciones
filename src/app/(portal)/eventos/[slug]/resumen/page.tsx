import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { assertEventAccess } from "@/lib/club-access"

export const dynamic = "force-dynamic"

export default async function LegacyEventSummaryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin")
  const { slug } = await params
  const event = await prisma.event.findUnique({ where: { slug }, select: { id: true } })
  if (event) {
    try {
      await assertEventAccess({ ...user, clubId: user.clubId }, event.id)
    } catch {
      redirect("/inscripciones")
    }
    const plan = await prisma.registrationPlan.findFirst({
      where: { clubId: user.clubId, eventId: event.id, status: { in: ["DRAFT", "AWAITING_PAYMENT", "PAID"] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, revision: true },
    })
    if (plan) redirect(`/inscripciones/${plan.id}/resumen?revision=${plan.revision}`)
  }
  redirect(`/inscripciones/nueva?evento=${encodeURIComponent(slug)}`)
}
