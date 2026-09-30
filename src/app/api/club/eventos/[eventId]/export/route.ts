import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getClubEventReport } from "@/lib/event-report"
import { buildClubEventReportWorkbook } from "@/lib/excel"
import { formatDateOnly, formatDateTimeLima, formatMoney } from "@/lib/utils"
import { assertEventAccess } from "@/lib/club-access"
import { explicitDisciplineAccess } from "@/lib/club-access"
import { getRequestIpHash, writeAuditLog } from "@/lib/security"

export const runtime = "nodejs"

// Reporte de inscripción descargable por el propio club. Primer endpoint /api
// abierto a rol CLUB del proyecto.
//
// No se usa requireClubUser(): lanza Error y en un route handler eso sería un
// 500 en vez de un 401. El clubId sale de la sesión y nunca de la URL, así que
// un club no puede pedir el reporte de otro cambiando el path.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const user = await getCurrentUser()
  if (!user || user.role !== "CLUB" || !user.clubId) {
    return NextResponse.json(
      { error: "Inicia sesión con un usuario de acceso de tu club para descargar el reporte." },
      { status: 401 }
    )
  }

  const { eventId } = await params
  try {
    await assertEventAccess({ ...user, clubId: user.clubId }, eventId)
  } catch {
    return NextResponse.json({ error: "Competencia no encontrada." }, { status: 404 })
  }
  const report = await getClubEventReport(
    eventId,
    user.clubId,
    explicitDisciplineAccess(user)
  )
  if (!report) {
    return NextResponse.json({ error: "Competencia no encontrada." }, { status: 404 })
  }

  const buffer = buildClubEventReportWorkbook({
    summaryRows: [
      { CONCEPTO: "Competencia", VALOR: report.event.name },
      { CONCEPTO: "Club", VALOR: report.clubName },
      {
        CONCEPTO: "Fechas",
        VALOR: `${formatDateOnly(report.event.startDate)} – ${formatDateOnly(report.event.endDate)}`,
      },
      {
        CONCEPTO: "Sede",
        VALOR: [report.event.venue, report.event.city].filter(Boolean).join(", "),
      },
      { CONCEPTO: "Temporada", VALOR: report.event.seasonName ?? "" },
      { CONCEPTO: "Inscripciones pagadas", VALOR: report.totals.paidRegistrations },
      { CONCEPTO: "Inscripciones por pagar", VALOR: report.totals.pendingRegistrations },
      { CONCEPTO: "Deportistas inscritos", VALOR: report.totals.distinctAthletes },
      { CONCEPTO: "Cuotas de competencia por deportista", VALOR: report.totals.athleteFees },
      { CONCEPTO: "Total", VALOR: formatMoney(report.totals.amount) },
      { CONCEPTO: "Generado", VALOR: formatDateTimeLima(new Date()) },
    ],
    modalityRows: report.modalityRows.map((row) => ({
      DISCIPLINA: row.discipline,
      PRUEBA: row.modalityName,
      CATEGORIA: row.category,
      SEXO: row.sexLabel,
      INSCRIPCIONES: row.entryCount,
      DEPORTISTAS: row.athleteCount,
      IMPORTE: row.amount,
    })),
    nominalRows: report.nominalRows.map((row) => ({
      DEPORTISTA: row.athleteName,
      DOCUMENTO: row.docNumber,
      "AÑO_NAC": row.birthYear,
      SEXO: row.sex,
      DISCIPLINA: row.discipline,
      PRUEBA: row.modalityName,
      CATEGORIA: row.category,
      RESERVA: row.isReserve ? "SÍ" : "",
      ESTADO: row.status,
    })),
    athleteFeeRows: report.athleteFeeRows.map((row) => ({
      DEPORTISTA: row.athleteName,
      DOCUMENTO: row.docNumber,
      "AÑO_NAC": row.birthYear,
      SEXO: row.sex,
      DISCIPLINA: row.discipline,
      CUOTA: row.fee,
      ESTADO: row.status,
    })),
    orderRows: report.orderRows.map((row) => ({
      CODIGO: row.code,
      FECHA: formatDateTimeLima(row.createdAt),
      ESTADO: row.status,
      CONCEPTOS: row.itemCount,
      TOTAL: row.amount,
    })),
  })

  const safeName = `${report.clubName}-${report.event.name}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .toLowerCase()
    .slice(0, 60)

  await writeAuditLog({
    actorId: user.id,
    actorRole: user.role,
    action: "club_event.export",
    targetType: "Event",
    targetId: eventId,
    ipHash: await getRequestIpHash(),
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="inscripcion-${safeName}.xlsx"`,
    },
  })
}
