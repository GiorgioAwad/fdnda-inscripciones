import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getEventReport } from "@/lib/event-report"
import { buildEventReportWorkbook } from "@/lib/excel"
import { formatDateTimeLima } from "@/lib/utils"
import { getRequestIpHash, writeAuditLog } from "@/lib/security"

export const runtime = "nodejs"

const ORDER_STATUS_ES: Record<string, string> = {
  PENDING: "Pendiente",
  PAID: "Pagada",
  FAILED: "Fallida",
  CANCELLED: "Cancelada",
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const { id } = await params
  const report = await getEventReport(id)
  if (!report) {
    return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 })
  }

  const buffer = buildEventReportWorkbook({
    eventName: report.event.name,
    generatedAt: formatDateTimeLima(new Date()),
    summaryRows: report.modalityRows.map((row) => ({
      DISCIPLINA: row.discipline,
      PRUEBA: row.name,
      CATEGORIA: row.category,
      SEXO: row.sexLabel,
      PRECIO: row.price,
      PAGADAS: row.paidCount,
      POR_PAGAR: row.pendingCount,
      DEPORTISTAS: row.athleteCount,
      RECAUDADO: row.revenue,
    })),
    clubRows: report.clubRows.map((row) => ({
      CLUB: row.clubName,
      INSCRIPCIONES: row.paidCount,
      DEPORTISTAS: row.athleteCount,
      MONTO: row.amount,
    })),
    nominalRows: report.nominalRows.map((row) => ({
      DEPORTISTA: row.athleteName,
      DOCUMENTO: row.docNumber,
      "AÑO_NAC": row.birthYear,
      SEXO: row.sex,
      CLUB: row.clubName,
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
      CLUB: row.clubName,
      DISCIPLINA: row.discipline,
      CUOTA: row.fee,
      ESTADO: row.status,
    })),
    orderRows: report.orderRows.map((order) => ({
      CODIGO: order.code,
      LEGADO: order.isLegacy ? "SÍ" : "",
      CLUB: order.clubName,
      FECHA: formatDateTimeLima(order.createdAt),
      INSCRIPCIONES: order.itemCount,
      MONTO_EVENTO: order.eventAmount,
      PROVEEDOR: order.provider,
      ESTADO: ORDER_STATUS_ES[order.status] ?? order.status,
    })),
  })

  const safeName = report.event.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .toLowerCase()
    .slice(0, 60)

  await writeAuditLog({
    actorId: user.id,
    actorRole: user.role,
    action: "event.export",
    targetType: "Event",
    targetId: id,
    ipHash: await getRequestIpHash(),
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reporte-${safeName}.xlsx"`,
    },
  })
}
