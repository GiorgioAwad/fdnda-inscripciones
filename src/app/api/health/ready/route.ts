import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { assertProductionConfiguration } from "@/lib/env"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    assertProductionConfiguration()
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json(
      { status: "ready", checkedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("Readiness check failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { status: "not_ready", checkedAt: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    )
  }
}

