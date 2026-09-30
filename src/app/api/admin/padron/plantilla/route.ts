import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { buildPadronTemplate } from "@/lib/excel"

export const runtime = "nodejs"

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Inicia sesión como administrador para descargar la plantilla del padrón." },
      { status: 401 }
    )
  }

  const clubs = await prisma.club.findMany({
    where: { isActive: true },
    select: { code: true, name: true },
    orderBy: { name: "asc" },
  })

  const buffer = buildPadronTemplate(clubs)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-padron-fdnda.xlsx"',
    },
  })
}
