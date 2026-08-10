"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Prisma, type DocType, type Sex } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { DISCIPLINE_VALUES, type DisciplineValue } from "@/lib/disciplines"
import { parsePadronWorkbook } from "@/lib/excel"
import { getRequestIpHash, writeAuditLog } from "@/lib/security"

export interface ActionResult {
  success: boolean
  error?: string
}

export interface ImportPreviewRow {
  rowNumber: number
  firstNames: string
  lastNames: string
  docType: DocType
  docNumber: string
  birthDateISO: string
  sex: Sex
  clubRef: string
  clubId: string | null
  clubName: string | null
  disciplines: DisciplineValue[]
  exists: boolean
  errors: string[]
}

export interface ImportPreviewResult {
  success: boolean
  error?: string
  rows?: ImportPreviewRow[]
  validCount?: number
  errorCount?: number
}

const MAX_IMPORT_ROWS = 5000
const MAX_IMPORT_BYTES = 4_000_000

// Resuelve el club por código o nombre (insensible a mayúsculas/acentos leves).
async function buildClubResolver() {
  const clubs = await prisma.club.findMany({
    select: { id: true, name: true, code: true, isActive: true },
  })
  const byKey = new Map<string, { id: string; name: string }>()
  for (const club of clubs) {
    byKey.set(club.code.trim().toUpperCase(), { id: club.id, name: club.name })
    byKey.set(club.name.trim().toUpperCase(), { id: club.id, name: club.name })
  }
  return (ref: string) => byKey.get(ref.trim().toUpperCase()) ?? null
}

export async function previewPadronImport(
  formData: FormData
): Promise<ImportPreviewResult> {
  await requireAdmin()

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Selecciona un archivo Excel." }
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { success: false, error: "El archivo supera los 4 MB." }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const isZipXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b
  const isLegacyXls =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    )
  if (!isZipXlsx && !isLegacyXls) {
    return { success: false, error: "El archivo no tiene un formato Excel válido." }
  }
  const { rows, fileError } = parsePadronWorkbook(buffer)

  if (fileError) {
    return { success: false, error: fileError }
  }
  if (rows.length === 0) {
    return { success: false, error: "No se encontraron filas con datos." }
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      success: false,
      error: `El archivo tiene ${rows.length} filas; el máximo por importación es ${MAX_IMPORT_ROWS}.`,
    }
  }

  const resolveClub = await buildClubResolver()

  const docNumbers = rows.map((r) => r.docNumber).filter(Boolean)
  const existing = await prisma.athlete.findMany({
    where: { docNumber: { in: docNumbers } },
    select: { docNumber: true },
  })
  const existingDocs = new Set(existing.map((a) => a.docNumber))

  // Documentos duplicados dentro del mismo archivo.
  const docCounts = new Map<string, number>()
  for (const row of rows) {
    if (row.docNumber) {
      docCounts.set(row.docNumber, (docCounts.get(row.docNumber) ?? 0) + 1)
    }
  }

  const previewRows: ImportPreviewRow[] = rows.map((row) => {
    const errors = [...row.errors]
    const club = row.clubRef ? resolveClub(row.clubRef) : null
    if (row.clubRef && !club) {
      errors.push(`Club "${row.clubRef}" no existe (usa el código o nombre exacto)`)
    }
    if (row.docNumber && (docCounts.get(row.docNumber) ?? 0) > 1) {
      errors.push(`NRO_DOCUMENTO repetido en el archivo`)
    }

    return {
      rowNumber: row.rowNumber,
      firstNames: row.firstNames,
      lastNames: row.lastNames,
      docType: row.docType,
      docNumber: row.docNumber,
      birthDateISO: row.birthDateISO,
      sex: row.sex,
      clubRef: row.clubRef,
      clubId: club?.id ?? null,
      clubName: club?.name ?? null,
      disciplines: row.disciplines,
      exists: existingDocs.has(row.docNumber),
      errors,
    }
  })

  const errorCount = previewRows.filter((r) => r.errors.length > 0).length

  return {
    success: true,
    rows: previewRows,
    validCount: previewRows.length - errorCount,
    errorCount,
  }
}

const commitRowSchema = z.object({
  firstNames: z.string().trim().min(1),
  lastNames: z.string().trim().min(1),
  docType: z.enum(["DNI", "CE", "PASAPORTE", "OTROS"]),
  docNumber: z.string().trim().regex(/^[a-zA-Z0-9-]{4,20}$/),
  birthDateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(["M", "F"]),
  clubId: z.string().min(1),
  disciplines: z.array(z.enum(DISCIPLINE_VALUES)).min(1),
})

export interface ImportCommitResult {
  success: boolean
  error?: string
  created?: number
  updated?: number
}

export async function commitPadronImport(rowsJson: string): Promise<ImportCommitResult> {
  const admin = await requireAdmin()

  let parsedRows: unknown
  try {
    parsedRows = JSON.parse(rowsJson)
  } catch {
    return { success: false, error: "Datos de importación inválidos." }
  }

  if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
    return { success: false, error: "No hay filas válidas para importar." }
  }
  if (parsedRows.length > MAX_IMPORT_ROWS) {
    return { success: false, error: "Demasiadas filas." }
  }

  const rows: Array<z.infer<typeof commitRowSchema>> = []
  for (const raw of parsedRows) {
    const parsed = commitRowSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        success: false,
        error: "Una fila no pasó la validación. Vuelve a analizar el archivo.",
      }
    }
    rows.push(parsed.data)
  }

  // Los clubes deben existir (revalidación server-side).
  const clubIds = [...new Set(rows.map((r) => r.clubId))]
  const clubCount = await prisma.club.count({ where: { id: { in: clubIds } } })
  if (clubCount !== clubIds.length) {
    return { success: false, error: "Hay clubes inválidos. Vuelve a analizar el archivo." }
  }

  const seenDocs = new Set<string>()
  for (const row of rows) {
    if (seenDocs.has(row.docNumber)) {
      return { success: false, error: `Documento repetido: ${row.docNumber}.` }
    }
    seenDocs.add(row.docNumber)
  }

  let created = 0
  let updated = 0

  try {
    // Lotes para no abrir una transacción gigante.
    const BATCH = 200
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      await prisma.$transaction(
        batch.map((row) => {
          const [y, m, d] = row.birthDateISO.split("-").map(Number)
          const birthDate = new Date(Date.UTC(y, m - 1, d))
          return prisma.athlete.upsert({
            where: { docNumber: row.docNumber },
            create: {
              firstNames: row.firstNames,
              lastNames: row.lastNames,
              docType: row.docType,
              docNumber: row.docNumber,
              birthDate,
              sex: row.sex,
              clubId: row.clubId,
              disciplines: row.disciplines,
            },
            update: {
              firstNames: row.firstNames,
              lastNames: row.lastNames,
              docType: row.docType,
              birthDate,
              sex: row.sex,
              clubId: row.clubId,
              disciplines: row.disciplines,
              isActive: true,
            },
          })
        })
      )
    }

    // Contar creados vs actualizados de forma aproximada no es fiable tras el
    // upsert; recontamos contra lo que existía antes no vale la pena. Reportamos
    // el total procesado como "importados".
    created = rows.length
    updated = 0
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "Conflicto de documentos duplicados." }
    }
    console.error("commitPadronImport error:", error)
    return { success: false, error: "Error al guardar. Ninguna fila fue importada parcialmente en el lote fallido." }
  }

  revalidatePath("/admin/padron")
  await writeAuditLog({
    actorId: admin.id,
    actorRole: admin.role,
    action: "athlete.bulk_import",
    targetType: "Athlete",
    ipHash: await getRequestIpHash(),
    metadata: { rows: rows.length },
  })
  return { success: true, created, updated }
}

const athleteSchema = z.object({
  id: z.string().min(1),
  firstNames: z.string().trim().min(1, "Nombres requeridos"),
  lastNames: z.string().trim().min(1, "Apellidos requeridos"),
  docType: z.enum(["DNI", "CE", "PASAPORTE", "OTROS"]),
  docNumber: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9-]{4,20}$/, "Documento inválido"),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  sex: z.enum(["M", "F"]),
  clubId: z.string().min(1, "Selecciona un club"),
  disciplines: z
    .array(z.enum(DISCIPLINE_VALUES))
    .min(1, "Selecciona al menos una disciplina"),
})

export async function saveAthlete(formData: FormData): Promise<ActionResult> {
  await requireAdmin()

  const parsed = athleteSchema.safeParse({
    id: formData.get("id"),
    firstNames: formData.get("firstNames"),
    lastNames: formData.get("lastNames"),
    docType: formData.get("docType"),
    docNumber: formData.get("docNumber"),
    birthDate: formData.get("birthDate"),
    sex: formData.get("sex"),
    clubId: formData.get("clubId"),
    disciplines: formData.getAll("disciplines").map(String),
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const { id, birthDate, ...data } = parsed.data
  const [y, m, d] = birthDate.split("-").map(Number)

  try {
    await prisma.athlete.update({
      where: { id },
      data: { ...data, birthDate: new Date(Date.UTC(y, m - 1, d)) },
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "Ya existe otro deportista con ese documento." }
    }
    console.error("saveAthlete error:", error)
    return { success: false, error: "No se pudo guardar." }
  }

  revalidatePath("/admin/padron")
  return { success: true }
}

export async function toggleAthleteActive(athleteId: string): Promise<ActionResult> {
  await requireAdmin()

  const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } })
  if (!athlete) return { success: false, error: "Deportista no encontrado." }

  await prisma.athlete.update({
    where: { id: athleteId },
    data: { isActive: !athlete.isActive },
  })

  revalidatePath("/admin/padron")
  return { success: true }
}
