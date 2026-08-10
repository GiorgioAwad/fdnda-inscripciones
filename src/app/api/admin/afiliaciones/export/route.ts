import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  affiliationState,
  athleteDisciplines,
  getCurrentSeason,
  getFederationOverview,
} from "@/lib/affiliations"
import { disciplineLabel } from "@/lib/disciplines"
import { buildAffiliationsWorkbook } from "@/lib/excel"
import { AFFILIATION_STATE_BADGE } from "@/components/ui/badge"
import { formatDateOnly, SEX_LABELS, toAmount } from "@/lib/utils"
import { getRequestIpHash, writeAuditLog } from "@/lib/security"

export const runtime = "nodejs"

function stateLabel(state: string): string {
  return AFFILIATION_STATE_BADGE[state]?.label ?? state
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const season = await getCurrentSeason()
  if (!season) {
    return NextResponse.json({ error: "No hay temporada vigente" }, { status: 404 })
  }

  const [{ clubs }, athletes] = await Promise.all([
    getFederationOverview(),
    prisma.athlete.findMany({
      where: { isActive: true },
      orderBy: [{ club: { name: "asc" } }, { lastNames: "asc" }],
      include: {
        club: { select: { name: true } },
        affiliations: { where: { seasonId: season.id } },
      },
    }),
  ])

  // Una fila por par (club, disciplina) y por (deportista, disciplina): con
  // cuota por disciplina, un club puede estar al día en una y deber la otra.
  const buffer = buildAffiliationsWorkbook({
    clubRows: clubs.flatMap((club) =>
      club.disciplines.map((row) => ({
        CLUB: club.clubName,
        CODIGO: club.clubCode,
        DISCIPLINA: disciplineLabel(row.discipline),
        ESTADO_AFILIACION: stateLabel(row.clubState),
        CUOTA: row.fee ?? "",
        VIGENCIA_HASTA: row.validTo ? formatDateOnly(row.validTo) : "",
        DEPORTISTAS: row.athletesTotal,
        ACTIVAS: row.athletesActive,
        PENDIENTES: row.athletesPending,
        SIN_VIGENCIA: row.athletesExpiredOrMissing,
      }))
    ),
    athleteRows: athletes.flatMap((athlete) =>
      athleteDisciplines(athlete.disciplines).map((discipline) => {
        const affiliation =
          athlete.affiliations.find((row) => row.discipline === discipline) ?? null
        return {
          DEPORTISTA: `${athlete.lastNames}, ${athlete.firstNames}`,
          DOCUMENTO: `${athlete.docType} ${athlete.docNumber}`,
          FECHA_NAC: formatDateOnly(athlete.birthDate),
          SEXO: SEX_LABELS[athlete.sex] ?? athlete.sex,
          CLUB: athlete.club.name,
          DISCIPLINA: disciplineLabel(discipline),
          ESTADO_AFILIACION: stateLabel(affiliationState(affiliation)),
          CUOTA: affiliation ? toAmount(affiliation.fee) : "",
          VIGENCIA_HASTA: affiliation ? formatDateOnly(affiliation.validTo) : "",
        }
      })
    ),
  })

  await writeAuditLog({
    actorId: user.id,
    actorRole: user.role,
    action: "affiliation.export",
    targetType: "Season",
    targetId: season.id,
    ipHash: await getRequestIpHash(),
    metadata: { athletes: athletes.length },
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="afiliaciones-${season.year}.xlsx"`,
    },
  })
}
