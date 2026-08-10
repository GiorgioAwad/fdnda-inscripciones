import { createHash } from "node:crypto"
import * as XLSX from "xlsx"

export type FoundationDiscipline =
  | "DIVING"
  | "ARTISTIC_SWIMMING"
  | "WATER_POLO"

export interface FoundationSourceRef {
  source: "ARTISTIC_DIVING" | "WATER_POLO"
  rowNumber: number
}

export interface FoundationAthlete {
  firstNames: string
  lastNames: string
  docType: "DNI" | "OTROS"
  docNumber: string
  birthDateISO: string
  sex: "M" | "F"
  clubName: string
  disciplines: FoundationDiscipline[]
  sources: FoundationSourceRef[]
}

export interface FoundationClub {
  name: string
  code: string
  username: string
  athleteCount: number
}

export interface FoundationImportIssue {
  severity: "ERROR" | "WARNING"
  source: FoundationSourceRef["source"]
  rowNumbers: number[]
  message: string
}

export interface FoundationImportResult {
  athletes: FoundationAthlete[]
  clubs: FoundationClub[]
  issues: FoundationImportIssue[]
  excludedRows: Array<{
    source: FoundationSourceRef["source"]
    rowNumber: number
    pendingFields: string[]
  }>
  stats: {
    artisticDivingRows: number
    waterPoloRows: number
    uniqueAthletes: number
    duplicateRowsMerged: number
    clubs: number
    excludedRows: number
  }
}

interface ParsedRow extends FoundationAthlete {
  source: FoundationSourceRef["source"]
  rowNumber: number
}

const CLUB_CODES: Record<string, string> = {
  "AQUATICA SPORT CENTER": "AQUATICA",
  "CLUB DEPORTIVO AQUALIFE": "AQUALIFE",
  "CLUB DEPORTIVO AQUALIMA": "AQUALIMA",
  "CLUB TENNIS LAS TERRAZAS MIRAF": "TERRAZAS",
  "LIMA SYNCHRO CLUB": "LIMASYNCHRO",
  "CLUB DE REGATAS LIMA": "REGATAS",
  "CLUB DEPORTIVO CAMPO DE MARTE": "CAMPO-MARTE",
  "CLUB DEPORTIVO NATACION EXTREM": "NATACION-EXTREM",
  "CLUB DEPORTIVO RABER DE TRUJILLO": "RABER-TRUJILLO",
  "CLUB DRAGA WATERPOLO AREQUIPA": "DRAGA-AREQUIPA",
  "NADADORES PADRE JOSE ALTO SELVA ALEGRE": "PADRE-JOSE-ASA",
}

function normalizeComparable(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
}

function cleanText(value: unknown): string {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ")
}

export function foundationDocumentFingerprint(docNumber: string): string {
  return createHash("sha256").update(docNumber).digest("hex").slice(0, 10)
}

function normalizeDocument(value: unknown): string {
  return cleanText(value).replace(/[.\s]/g, "").toUpperCase()
}

function docTypeFor(docNumber: string): FoundationAthlete["docType"] {
  return /^\d{8}$/.test(docNumber) ? "DNI" : "OTROS"
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear()
    const month = value.getMonth() + 1
    const day = value.getDate()
    return formatValidatedDate(year, month, day)
  }

  const text = cleanText(value)
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (match) return formatValidatedDate(Number(match[1]), Number(match[2]), Number(match[3]))

  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (match) return formatValidatedDate(Number(match[3]), Number(match[2]), Number(match[1]))
  return null
}

function formatValidatedDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function headerSignature(row: unknown[]): string {
  return row.map(normalizeComparable).join("|")
}

function workbookRows(buffer: Buffer, sheetName: string): unknown[][] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`No existe la hoja requerida "${sheetName}".`)
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true })
}

function issue(
  severity: FoundationImportIssue["severity"],
  source: FoundationSourceRef["source"],
  rowNumber: number,
  message: string
): FoundationImportIssue {
  return { severity, source, rowNumbers: [rowNumber], message }
}

function validateRow(row: ParsedRow): FoundationImportIssue[] {
  const issues: FoundationImportIssue[] = []
  const ref = `identificador ${foundationDocumentFingerprint(row.docNumber)}`
  if (!row.firstNames) issues.push(issue("ERROR", row.source, row.rowNumber, "Nombres vacíos."))
  if (!row.lastNames) issues.push(issue("ERROR", row.source, row.rowNumber, "Apellidos vacíos."))
  if (!/^[A-Z0-9-]{4,20}$/.test(row.docNumber)) {
    issues.push(issue("ERROR", row.source, row.rowNumber, `Documento inválido (${ref}).`))
  }
  if (!row.birthDateISO) issues.push(issue("ERROR", row.source, row.rowNumber, `Fecha inválida (${ref}).`))
  if (!row.clubName) issues.push(issue("ERROR", row.source, row.rowNumber, `Club vacío (${ref}).`))
  if (!row.disciplines.length) {
    issues.push(issue("ERROR", row.source, row.rowNumber, `Disciplina inválida (${ref}).`))
  }
  return issues
}

function parseArtisticDiving(buffer: Buffer): { rows: ParsedRow[]; issues: FoundationImportIssue[] } {
  const data = workbookRows(buffer, "Afiliados")
  const expected = "LAST|FIRST|ID_NO|SEX|BIRTH|CLUB|DISCIPLINA"
  if (!data[0] || headerSignature(data[0]) !== expected) {
    throw new Error("La estructura de BD ARTISTICA Y CLAVADOS.xlsx cambió; se canceló la importación.")
  }

  const rows: ParsedRow[] = []
  const issues: FoundationImportIssue[] = []
  for (let index = 1; index < data.length; index += 1) {
    const raw = data[index]
    if (!raw.some((value) => cleanText(value))) continue
    // Este archivo legado tiene los títulos D/E/F desplazados. La posición real,
    // verificada contra las 120 filas, es nacimiento/club/sexo.
    const disciplineLabel = normalizeComparable(raw[6])
    const discipline =
      disciplineLabel === "CLAVADOS"
        ? "DIVING"
        : disciplineLabel === "NAT. ARTISTICA"
          ? "ARTISTIC_SWIMMING"
          : null
    const docNumber = normalizeDocument(raw[2])
    const birthDateISO = parseDate(raw[3]) ?? ""
    const row: ParsedRow = {
      firstNames: cleanText(raw[0]),
      lastNames: cleanText(raw[1]),
      docType: docTypeFor(docNumber),
      docNumber,
      birthDateISO,
      sex: normalizeComparable(raw[5]) === "F" ? "F" : "M",
      clubName: cleanText(raw[4]),
      disciplines: discipline ? [discipline] : [],
      sources: [{ source: "ARTISTIC_DIVING", rowNumber: index + 1 }],
      source: "ARTISTIC_DIVING",
      rowNumber: index + 1,
    }
    if (!["M", "F"].includes(normalizeComparable(raw[5]))) {
      issues.push(issue("ERROR", row.source, row.rowNumber, "Sexo inválido."))
    }
    issues.push(...validateRow(row))
    rows.push(row)
  }
  return { rows, issues }
}

function parseWaterPolo(buffer: Buffer): { rows: ParsedRow[]; issues: FoundationImportIssue[] } {
  const data = workbookRows(buffer, "Hoja1")
  const expected = "NOMBRE|PATERNO|MATERNO|DOCUMENTO|NACIMIENTO|SEXO|CLUB"
  if (!data[0] || headerSignature(data[0]) !== expected) {
    throw new Error("La estructura de BD POLO ACUATICO.xlsx cambió; se canceló la importación.")
  }

  const rows: ParsedRow[] = []
  const issues: FoundationImportIssue[] = []
  for (let index = 1; index < data.length; index += 1) {
    const raw = data[index]
    if (!raw.some((value) => cleanText(value))) continue
    const docNumber = normalizeDocument(raw[3])
    const row: ParsedRow = {
      firstNames: cleanText(raw[0]),
      lastNames: [cleanText(raw[1]), cleanText(raw[2])].filter(Boolean).join(" "),
      docType: docTypeFor(docNumber),
      docNumber,
      birthDateISO: parseDate(raw[4]) ?? "",
      sex: normalizeComparable(raw[5]) === "F" ? "F" : "M",
      clubName: cleanText(raw[6]),
      disciplines: ["WATER_POLO"],
      sources: [{ source: "WATER_POLO", rowNumber: index + 1 }],
      source: "WATER_POLO",
      rowNumber: index + 1,
    }
    if (!["M", "F"].includes(normalizeComparable(raw[5]))) {
      issues.push(issue("ERROR", row.source, row.rowNumber, "Sexo inválido."))
    }
    issues.push(...validateRow(row))
    rows.push(row)
  }
  return { rows, issues }
}

function sameIdentity(left: ParsedRow | FoundationAthlete, right: ParsedRow): boolean {
  return (
    normalizeComparable(left.firstNames) === normalizeComparable(right.firstNames) &&
    normalizeComparable(left.lastNames) === normalizeComparable(right.lastNames) &&
    left.birthDateISO === right.birthDateISO &&
    left.sex === right.sex &&
    normalizeComparable(left.clubName) === normalizeComparable(right.clubName)
  )
}

function fallbackClubCode(name: string): string {
  const normalized = normalizeComparable(name).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")
  const digest = createHash("sha256").update(normalizeComparable(name)).digest("hex").slice(0, 4).toUpperCase()
  return `${normalized.slice(0, 15).replace(/-$/g, "")}-${digest}`
}

export function clubCodeFor(name: string): string {
  return CLUB_CODES[normalizeComparable(name)] ?? fallbackClubCode(name)
}

export function normalizeClubIdentity(name: string): string {
  return normalizeComparable(name)
}

export function parseFoundationWorkbooks(input: {
  artisticDiving: Buffer
  waterPolo: Buffer
}, options: { excludeInvalidRows?: boolean } = {}): FoundationImportResult {
  const artistic = parseArtisticDiving(input.artisticDiving)
  const polo = parseWaterPolo(input.waterPolo)
  const parseIssues = [...artistic.issues, ...polo.issues]
  const invalidRows = new Map<string, Set<string>>()
  for (const item of parseIssues.filter((candidate) => candidate.severity === "ERROR")) {
    for (const rowNumber of item.rowNumbers) {
      const key = `${item.source}:${rowNumber}`
      const fields = invalidRows.get(key) ?? new Set<string>()
      if (item.message.startsWith("Fecha")) fields.add("birthDate")
      else if (item.message.startsWith("Documento")) fields.add("docNumber")
      else if (item.message.startsWith("Nombres")) fields.add("firstNames")
      else if (item.message.startsWith("Apellidos")) fields.add("lastNames")
      else if (item.message.startsWith("Sexo")) fields.add("sex")
      else if (item.message.startsWith("Club")) fields.add("club")
      else if (item.message.startsWith("Disciplina")) fields.add("disciplines")
      else fields.add("unknown")
      invalidRows.set(key, fields)
    }
  }
  const excludedRows = options.excludeInvalidRows
    ? [...invalidRows].map(([key, fields]) => {
        const [source, rowNumber] = key.split(":")
        return {
          source: source as FoundationSourceRef["source"],
          rowNumber: Number(rowNumber),
          pendingFields: [...fields].sort(),
        }
      })
    : []
  const issues = parseIssues.map((item) =>
    options.excludeInvalidRows && item.severity === "ERROR"
      ? { ...item, severity: "WARNING" as const, message: `Fila excluida: ${item.message}` }
      : item
  )
  const merged = new Map<string, FoundationAthlete>()
  let duplicateRowsMerged = 0

  for (const row of [...artistic.rows, ...polo.rows].filter(
    (candidate) => !options.excludeInvalidRows || !invalidRows.has(`${candidate.source}:${candidate.rowNumber}`)
  )) {
    const current = merged.get(row.docNumber)
    if (!current) {
      merged.set(row.docNumber, {
        firstNames: row.firstNames,
        lastNames: row.lastNames,
        docType: row.docType,
        docNumber: row.docNumber,
        birthDateISO: row.birthDateISO,
        sex: row.sex,
        clubName: row.clubName,
        disciplines: [...row.disciplines],
        sources: [...row.sources],
      })
      continue
    }

    if (!sameIdentity(current, row)) {
      issues.push({
        severity: "ERROR",
        source: row.source,
        rowNumbers: [...current.sources.map((source) => source.rowNumber), row.rowNumber],
        message: `El mismo documento (${foundationDocumentFingerprint(row.docNumber)}) tiene datos personales o club incompatibles.`,
      })
      continue
    }

    duplicateRowsMerged += 1
    current.sources.push(...row.sources)
    current.disciplines = [...new Set([...current.disciplines, ...row.disciplines])]
    issues.push({
      severity: "WARNING",
      source: row.source,
      rowNumbers: current.sources.map((source) => source.rowNumber),
      message: `Fila duplicada fusionada de forma segura (${foundationDocumentFingerprint(row.docNumber)}).`,
    })
  }

  const athletes = [...merged.values()].sort((a, b) => a.docNumber.localeCompare(b.docNumber))
  const clubCounts = new Map<string, { name: string; athletes: Set<string> }>()
  for (const athlete of athletes) {
    const key = normalizeComparable(athlete.clubName)
    const current = clubCounts.get(key) ?? { name: athlete.clubName, athletes: new Set<string>() }
    current.athletes.add(athlete.docNumber)
    clubCounts.set(key, current)
  }
  const clubs = [...clubCounts.values()]
    .map(({ name, athletes: clubAthletes }) => {
      const code = clubCodeFor(name)
      return { name, code, username: code.toLowerCase(), athleteCount: clubAthletes.size }
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"))

  return {
    athletes,
    clubs,
    issues,
    excludedRows,
    stats: {
      artisticDivingRows: artistic.rows.length,
      waterPoloRows: polo.rows.length,
      uniqueAthletes: athletes.length,
      duplicateRowsMerged,
      clubs: clubs.length,
      excludedRows: excludedRows.length,
    },
  }
}
