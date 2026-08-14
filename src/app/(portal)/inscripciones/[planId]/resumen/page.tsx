import Link from "next/link"
import { AlertTriangle, ClipboardCheck } from "lucide-react"
import { notFound, redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import { PrintSheetFooter, PrintSheetHeader } from "@/components/print-sheet"
import { getCurrentUser } from "@/lib/auth"
import { disciplineLabel } from "@/lib/disciplines"
import { entryChargeNoteLabel } from "@/lib/entry-charge-note"
import { prisma } from "@/lib/prisma"
import { getRegistrationPlan } from "@/lib/registration-plans"
import { registrationOrderItemView } from "@/lib/registration-snapshots"
import { validateRegistrationPlan } from "@/lib/plan-validation"
import { assertPlanAccess } from "@/lib/club-access"
import { formatDateOnly, formatMoney } from "@/lib/utils"
import { PrintButton } from "./print-button"

export const dynamic = "force-dynamic"

export default async function PrintablePlanSummary({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>
  searchParams: Promise<{ revision?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  if (!user.clubId) redirect("/admin")
  const [{ planId }, query] = await Promise.all([params, searchParams])
  try {
    await assertPlanAccess({ ...user, clubId: user.clubId }, planId)
  } catch {
    notFound()
  }
  const expectedRevision = Number.parseInt(query.revision ?? "", 10)
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    redirect(`/inscripciones/${planId}`)
  }

  const plan = await getRegistrationPlan({ planId, clubId: user.clubId })
  if (!plan) notFound()
  // Una planilla con orden ya tiene un snapshot contractual. No se vuelve a
  // validar contra nombres, reglas, precios o estado actuales del evento.
  const validation = plan.status === "DRAFT"
    ? await validateRegistrationPlan({
        planId,
        clubId: user.clubId,
        expectedRevision,
        mode: "REVIEW",
      })
    : null
  const revisionChanged = plan.revision !== expectedRevision
  const orderItems = plan.eventId
    ? await prisma.orderItem.findMany({
        where: {
          registrationId: { not: null },
          AND: [
            {
              order: {
                clubId: user.clubId,
                kind: "REGISTRATION",
                status: { in: ["PENDING", "PAID"] },
              },
            },
            {
              OR: [
                { order: { eventId: plan.eventId } },
                { registration: { modality: { eventId: plan.eventId } } },
              ],
            },
          ],
        },
        include: {
          order: {
            select: { registrationPlanId: true, status: true, createdAt: true },
          },
        },
        orderBy: { order: { createdAt: "asc" } },
      })
    : []
  const currentRegistrationIds = new Set(plan.registrations.map((entry) => entry.id))
  const frozenItems = orderItems.map((item) => ({
    id: item.id,
    registrationId: item.registrationId,
    orderStatus: item.order.status,
    orderPlanId: item.order.registrationPlanId,
    ...registrationOrderItemView(item),
  }))
  const currentFrozen = frozenItems.filter(
    (item) =>
      item.orderPlanId === plan.id ||
      (item.registrationId !== null && currentRegistrationIds.has(item.registrationId))
  )
  const previousFrozen = frozenItems.filter(
    (item) => !currentFrozen.some((current) => current.id === item.id)
  )
  const frozenHeader = currentFrozen.find((item) => item.snapshot)?.snapshot
  const frozenAthletes = new Set(
    currentFrozen.flatMap((item) =>
      item.snapshot?.registration.athletes.map((athlete) => athlete.id) ?? []
    )
  )
  const liveRegisteredAthletes = new Set(
    plan.registrations.flatMap((entry) =>
      entry.athletes.map((row) => row.athleteId)
    )
  )
  // Las disciplinas que aparecen realmente en esta planilla: es lo que pinta la
  // franja, en pantalla y en la hoja impresa.
  const sheetDisciplines = [
    ...new Set(plan.registrations.map((entry) => entry.modality.discipline)),
  ]
  // Cuánto se cobra REALMENTE por cada formación no congelada (sin orden
  // todavía). `modality.price` es el precio de lista, no lo que se cobra: si
  // hay validación (planilla DRAFT) se lee `chargedEntry` de su desglose por
  // disciplina, que ya trae la elección del club aplicada. Sin validación
  // (planilla sin orden ni validación vigente, caso raro) no hay con qué
  // saber mejor y se usa el precio de lista, igual que antes — pero la misma
  // función alimenta el total Y cada línea, así que como mínimo cuadran entre
  // sí.
  const chargedEntryByDiscipline = new Map(
    validation?.summary.byDiscipline.map((row) => [row.discipline, row.chargedEntry]) ??
      []
  )
  const chargedEntryPrice = (entry: (typeof plan.registrations)[number]) => {
    const chargedEntry = chargedEntryByDiscipline.get(entry.modality.discipline) ?? true
    return chargedEntry ? Number(entry.modality.price) : 0
  }
  const frozenSummary = currentFrozen.length > 0
    ? {
        rosterAthleteCount: frozenAthletes.size || plan.athletes.length,
        registeredAthleteCount:
          frozenAthletes.size || liveRegisteredAthletes.size,
        entryCount: currentFrozen.length,
        totalAmount: currentFrozen.reduce((total, item) => total + item.unitPrice, 0),
      }
    : validation?.summary ?? {
        rosterAthleteCount: plan.athletes.length,
        registeredAthleteCount: liveRegisteredAthletes.size,
        entryCount: plan.registrations.length,
        totalAmount: plan.registrations.reduce(
          (total, entry) => total + chargedEntryPrice(entry),
          0
        ),
      }

  return (
    <div className="space-y-6 bg-white print:p-0">
      <PrintSheetHeader
        title="Planilla de inscripción"
        eventName={frozenHeader?.event.name ?? plan.event?.name ?? undefined}
        clubName={frozenHeader?.club.name ?? plan.club.name}
        disciplines={sheetDisciplines}
        meta={[
          { label: "Revisión", value: String(expectedRevision) },
          { label: "Deportistas", value: String(frozenSummary.rosterAthleteCount) },
          { label: "Formaciones", value: String(frozenSummary.entryCount) },
          { label: "Total", value: formatMoney(frozenSummary.totalAmount) },
        ]}
      />

      <PageHeader
        className="print-hidden"
        icon={ClipboardCheck}
        lanes={sheetDisciplines}
        eyebrow={`Planilla · revisión ${expectedRevision}`}
        title={frozenHeader?.event.name ?? plan.event?.name ?? "Planilla sin competencia"}
        description={`${frozenHeader?.club.name ?? plan.club.name}${frozenHeader ? ` · ${formatDateOnly(frozenHeader.event.startDate)} al ${formatDateOnly(frozenHeader.event.endDate)}` : plan.event ? ` · ${formatDateOnly(plan.event.startDate)} al ${formatDateOnly(plan.event.endDate)}` : ""}`}
        actions={revisionChanged ? undefined : <PrintButton />}
      />

      {revisionChanged ? (
        <Card className="border-fdnda-danger-ring bg-fdnda-danger-soft p-5 text-fdnda-danger">
          <div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0" /><div><h2 className="font-bold">La planilla cambió antes de imprimir</h2><p className="mt-1 text-sm">Se solicitó la revisión {expectedRevision}, pero el servidor tiene la revisión {plan.revision}. No se generó una hoja que pudiera mezclar versiones.</p><Link className="mt-3 inline-block font-bold underline" href={`/inscripciones/${plan.id}`}>Volver y cargar la versión vigente</Link></div></div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Nómina" value={frozenSummary.rosterAthleteCount} />
            <Metric label="Con pruebas" value={frozenSummary.registeredAthleteCount} />
            <Metric label="Formaciones" value={frozenSummary.entryCount} />
            <Metric label={currentFrozen.length > 0 ? "Total congelado" : "Total actual"} value={formatMoney(frozenSummary.totalAmount)} />
          </div>

          <section>
            <h2 className="mb-3 font-heading text-lg font-bold text-fdnda-navy">Inscripciones de esta planilla</h2>
            <div className="space-y-3">
              {currentFrozen.length > 0 ? currentFrozen.map((item, index) => (
                <FrozenItemCard key={item.id} index={index} item={item} />
              )) : plan.registrations.map((entry, index) => (
                <Card key={entry.id} className="p-4 break-inside-avoid">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-fdnda-turquoise-deep">{disciplineLabel(entry.modality.discipline)}</p><h3 className="font-bold text-fdnda-navy">{index + 1}. {entry.modality.name}{entry.modality.category ? ` · ${entry.modality.category}` : ""}</h3></div><strong>{formatMoney(chargedEntryPrice(entry))}</strong></div>
                  <p className="mt-2 text-sm text-fdnda-ink">{entry.athletes.map((row) => `${row.athlete.lastNames}, ${row.athlete.firstNames}${row.isReserve ? " (reserva)" : ""}`).join(" · ") || "Formación incompleta"}</p>
                </Card>
              ))}
            </div>
          </section>

          {previousFrozen.length > 0 ? (
            <section>
              <h2 className="mb-1 font-heading text-lg font-bold text-fdnda-navy">Inscripciones previas bloqueadas</h2>
              <p className="mb-3 text-sm text-fdnda-muted">Resumen global de órdenes pagadas o pendientes del club para la misma competencia.</p>
              <div className="space-y-3">{previousFrozen.map((item, index) => <FrozenItemCard key={item.id} index={index} item={item} showStatus />)}</div>
            </section>
          ) : null}

          {validation && validation.issues.length > 0 ? <section><h2 className="mb-3 font-heading text-lg font-bold text-fdnda-navy">Observaciones de validación</h2><ul className="space-y-2">{validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className="flex gap-2 text-sm"><Badge variant={issue.severity === "ERROR" ? "danger" : "warning"}>{issue.severity === "ERROR" ? "Error" : "Aviso"}</Badge><span>{issue.message}</span></li>)}</ul></section> : null}
        </>
      )}

      {revisionChanged ? null : <PrintSheetFooter />}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-eyebrow uppercase text-fdnda-muted">{label}</p>
      <p className="num mt-1 text-2xl text-fdnda-navy">{value}</p>
    </Card>
  )
}

function FrozenItemCard({
  item,
  index,
  showStatus = false,
}: {
  item: ReturnType<typeof registrationOrderItemView> & {
    id: string
    orderStatus: string
  }
  index: number
  showStatus?: boolean
}) {
  const snapshot = item.snapshot
  return (
    <Card className="p-4 break-inside-avoid">
      <div className="flex flex-wrap items-start gap-3">
        {showStatus ? (
          <Badge variant={item.orderStatus === "PAID" ? "success" : "warning"}>
            {item.orderStatus === "PAID" ? "Pagada" : "Pendiente"}
          </Badge>
        ) : null}
        <div className="min-w-0 flex-1">
          {snapshot ? (
            <>
              <p className="text-xs font-bold uppercase tracking-wide text-fdnda-turquoise-deep">
                {disciplineLabel(snapshot.modality.discipline)}
              </p>
              <h3 className="font-bold text-fdnda-navy">
                {index + 1}. {snapshot.modality.name}
                {snapshot.modality.category ? ` · ${snapshot.modality.category}` : ""}
              </h3>
              <p className="mt-2 text-sm text-fdnda-ink">
                {snapshot.registration.athletes
                  .map(
                    (athlete) =>
                      `${athlete.lastNames}, ${athlete.firstNames}${athlete.isReserve ? " (reserva)" : ""}`
                  )
                  .join(" · ")}
              </p>
              {item.note && item.note !== "CHARGED" ? (
                <p className="mt-1 text-xs italic text-fdnda-muted">
                  {entryChargeNoteLabel(item.note)}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-fdnda-ink">{item.description}</p>
          )}
        </div>
        <strong>{formatMoney(item.unitPrice)}</strong>
      </div>
    </Card>
  )
}
