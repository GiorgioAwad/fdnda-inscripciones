import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(
    { status: "ok", checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  )
}

