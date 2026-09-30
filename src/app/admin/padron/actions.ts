"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { Prisma, type DocType, type Sex } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth"
import { DISCIPLINE_VALUES, type DisciplineValue } from "@/lib/disciplines"
import { parsePadronWorkbook } from "@/lib/excel"
import { getRequestIpHash, writeAuditLog } from "@/lib/security"
import { plural } from "@/lib/utils"

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
  // Club actual del documento cuando ya existe y el archivo trae otro: la
  // importación lo mueve igual, pero la vista previa tiene que avisarlo.
  currentClubName: string | null
  clubChange: boolean
  // El club del archivo está desactivado: se importa, pero sus usuarios no
  // pueden entrar al portal.
  clubInactive: boolean
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
  const byKey = new Map<string, { id: string; name: string; isActive: boolean }>()
  for (const club of clubs) {
    const value = { id: club.id, name: club.name, isActive: club.isActive }
    byKey.set(club.code.trim().toUpperCase(), value)
    byKey.set(club.name.trim().toUpperCase(), value)
  }
  return (ref: string) => byKey.get(ref.trim().toUpperCase()) ?? null
}

export async function previewPadronImport(
  formData: FormData
): Promise<ImportPreviewResult> {
  await requireAdmin()

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Elige un archivo Excel (.xlsx o .xls) con el padrón." }
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return {
      success: false,
      error: "El archivo pesa más de 4 MB. Divide el padrón en dos archivos e impórtalos por separado.",
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const isZipXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b
  const isLegacyXls =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    )
  if (!isZipXlsx && !isLegacyXls) {
    return {
      success: false,
      error: "El archivo no es un Excel (.xlsx o .xls). Descarga la plantilla y copia ahí tus datos.",
    }
  }
  const { rows, fileError } = parsePadronWorkbook(buffer)

  if (fileError) {
    return { success: false, error: fileError }
  }
  if (rows.length === 0) {
    return {
      success: false,
      error: "El archivo no tiene filas con datos debajo de los encabezados.",
    }
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      success: false,
      error: `El archivo tiene ${rows.length} filas y el máximo por importación es ${MAX_IMPORT_ROWS}. Divídelo en varios archivos.`,
    }
  }

  const resolveClub = await buildClubResolver()

  const docNumbers = rows.map((r) => r.docNumber).filter(Boolean)
  const existing = await prisma.athlete.findMany({
    where: { docNumber: { in: docNumbers } },
    select: { docNumber: true, clubId: true, club: { select: { name: true } } },
  })
  const existingByDoc = new Map(existing.map((a) => [a.docNumber, a]))

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
      errors.push(`CLUB «${row.clubRef}» no existe: usa el código o el nombre exacto (hoja Clubes)`)
    }
    if (row.docNumber && (docCounts.get(row.docNumber) ?? 0) > 1) {
      errors.push("NRO_DOCUMENTO repetido en el archivo")
    }

    const current = existingByDoc.get(row.docNumber) ?? null
    const clubChange = Boolean(current && club && current.clubId !== club.id)

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
      exists: current !== null,
      currentClubName: current?.club.name ?? null,
      clubChange,
      clubInactive: Boolean(club && !club.isActive),
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
  // Fila del Excel: solo sirve para decir desde dónde falló un guardado.
  rowNumber: z.number().int().positive().optional(),
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
    return {
      success: false,
      error: "No se pudo leer la vista previa. Vuelve a analizar el archivo.",
    }
  }

  if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
    return { success: false, error: "No hay filas sin errores para importar." }
  }
  if (parsedRows.length > MAX_IMPORT_ROWS) {
    return {
      success: false,
      error: `Son más de ${MAX_IMPORT_ROWS} filas. Divide el archivo e impórtalo por partes.`,
    }
  }

  const rows: Array<z.infer<typeof commitRowSchema>> = []
  for (const raw of parsedRows) {
    const parsed = commitRowSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        success: false,
        error: "Una fila cambió desde la vista previa. Vuelve a analizar el archivo.",
      }
    }
    rows.push(parsed.data)
  }

  // Los clubes deben existir (revalidación server-side).
  const clubIds = [...new Set(rows.map((r) => r.clubId))]
  const clubCount = await prisma.club.count({ where: { id: { in: clubIds } } })
  if (clubCount !== clubIds.length) {
    return {
      success: false,
      error: "Uno de los clubes del archivo ya no existe. Vuelve a analizar el archivo.",
    }
  }

  const seenDocs = new Set<string>()
  for (const row of rows) {
    if (seenDocs.has(row.docNumber)) {
      return {
        success: false,
        error: `El N.º de documento ${row.docNumber} está repetido. Corrígelo y vuelve a analizar el archivo.`,
      }
    }
    seenDocs.add(row.docNumber)
  }

  // Nuevos frente a actualizados se cuenta ANTES del upsert: después ya no
  // hay forma de distinguirlos.
  const existingDocs = new Set(
    (
      await prisma.athlete.findMany({
        where: { docNumber: { in: rows.map((row) => row.docNumber) } },
        select: { docNumber: true },
      })
    ).map((athlete) => athlete.docNumber)
  )

  let created = 0
  let updated = 0
  // Cada lote se guarda en su propia transacción: si falla el tercero, los dos
  // primeros ya quedaron guardados y el mensaje tiene que decirlo.
  const BATCH = 200
  let savedRows = 0

  try {
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
      for (const row of batch) {
        if (existingDocs.has(row.docNumber)) updated += 1
        else created += 1
      }
      savedRows += batch.length
    }
  } catch (error) {
    console.error("commitPadronImport error:", error)
    const duplicate =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    const cause = duplicate
      ? "otro deportista ya usa uno de esos N.º de documento"
      : "no se pudo guardar un lote de filas"
    const failedRow = rows[savedRows]?.rowNumber

    if (savedRows > 0) {
      revalidatePath("/admin/padron")
      await writeAuditLog({
        actorId: admin.id,
        actorRole: admin.role,
        action: "athlete.bulk_import",
        targetType: "Athlete",
        success: false,
        ipHash: await getRequestIpHash(),
        metadata: { rows: rows.length, created, updated, saved: savedRows },
      })
    }

    return {
      success: false,
      created,
      updated,
      error:
        savedRows === 0
          ? `No se guardó ninguna fila: ${cause}. Vuelve a analizar el archivo e inténtalo de nuevo.`
          : `Se guardaron ${plural(savedRows, "fila", "filas")} (${created} ${created === 1 ? "nueva" : "nuevas"} y ${updated} ${updated === 1 ? "actualizada" : "actualizadas"}), pero ${cause}${failedRow ? ` desde la fila ${failedRow} del Excel` : ""} y de ahí en adelante no se guardó nada. Vuelve a analizar el archivo: lo ya guardado aparecerá como «Actualizará».`,
    }
  }

  revalidatePath("/admin/padron")
  await writeAuditLog({
    actorId: admin.id,
    actorRole: admin.role,
    action: "athlete.bulk_import",
    targetType: "Athlete",
    ipHash: await getRequestIpHash(),
    metadata: { rows: rows.length, created, updated },
  })
  return { success: true, created, updated }
}

const athleteSchema = z.object({
  id: z.string().min(1),
  firstNames: z.string().trim().min(1, "Escribe los nombres."),
  lastNames: z.string().trim().min(1, "Escribe los apellidos."),
  docType: z.enum(["DNI", "CE", "PASAPORTE", "OTROS"], {
    error: "Elige el tipo de documento.",
  }),
  docNumber: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9-]{4,20}$/,
      "El N.º de documento debe tener de 4 a 20 letras, números o guiones."
    ),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha de nacimiento."),
  sex: z.enum(["M", "F"], { error: "Elige el sexo." }),
  clubId: z.string().min(1, "Elige el club."),
  disciplines: z
    .array(z.enum(DISCIPLINE_VALUES))
    .min(1, "Marca al menos una disciplina."),
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
      return {
        success: false,
        error: "Ya hay otro deportista con ese N.º de documento. Revisa el número.",
      }
    }
    console.error("saveAthlete error:", error)
    return {
      success: false,
      error: "No se pudieron guardar los datos del deportista. Inténtalo de nuevo.",
    }
  }

  revalidatePath("/admin/padron")
  return { success: true }
}

// Estado explícito, no un conmutador: la pantalla confirma «Dar de baja» y el
// servidor aplica exactamente eso.
export async function setAthleteActive(
  athleteId: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireAdmin()

  const athlete = await prisma.athlete.findUnique({ where: { id: athleteId } })
  if (!athlete) {
    return { success: false, error: "Ese deportista ya no existe. Recarga la página." }
  }

  await prisma.athlete.update({
    where: { id: athleteId },
    data: { isActive },
  })

  revalidatePath("/admin/padron")
  return { success: true }
}
