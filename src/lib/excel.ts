import * as XLSX from "xlsx"
import { DISCIPLINES, DISCIPLINE_VALUES, type DisciplineValue } from "./disciplines"

// ==================== PADRÓN: PLANTILLA ====================

export const PADRON_HEADERS = [
  "NOMBRES",
  "APELLIDOS",
  "TIPO_DOCUMENTO",
  "NRO_DOCUMENTO",
  "FECHA_NACIMIENTO",
  "SEXO",
  "CLUB",
  "DISCIPLINAS",
] as const

export function buildPadronTemplate(clubs: Array<{ code: string; name: string }>): Buffer {
  const workbook = XLSX.utils.book_new()

  const example = [
    {
      NOMBRES: "María Fernanda",
      APELLIDOS: "Pérez Gómez",
      TIPO_DOCUMENTO: "DNI",
      NRO_DOCUMENTO: "71234567",
      FECHA_NACIMIENTO: "15/03/2012",
      SEXO: "F",
      CLUB: clubs[0]?.code ?? "CODIGO_CLUB",
      DISCIPLINAS: "CLAVADOS, POLO",
    },
  ]
  const padronSheet = XLSX.utils.json_to_sheet(example, {
    header: [...PADRON_HEADERS],
  })
  padronSheet["!cols"] = [
    { wch: 22 },
    { wch: 24 },
    { wch: 16 },
    { wch: 15 },
    { wch: 18 },
    { wch: 6 },
    { wch: 18 },
    { wch: 28 },
  ]
  XLSX.utils.book_append_sheet(workbook, padronSheet, "Padron")

  const clubsSheet = XLSX.utils.json_to_sheet(
    clubs.map((c) => ({ CODIGO: c.code, NOMBRE: c.name }))
  )
  clubsSheet["!cols"] = [{ wch: 15 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(workbook, clubsSheet, "Clubes")

  const disciplinesSheet = XLSX.utils.json_to_sheet(
    DISCIPLINE_VALUES.map((value) => ({
      DISCIPLINA: DISCIPLINES[value].label,
      SE_ESCRIBE: DISCIPLINE_ALIASES_HELP[value],
    }))
  )
  disciplinesSheet["!cols"] = [{ wch: 24 }, { wch: 46 }]
  XLSX.utils.book_append_sheet(workbook, disciplinesSheet, "Disciplinas")

  const notes = XLSX.utils.aoa_to_sheet([
    ["Instrucciones"],
    ["- TIPO_DOCUMENTO: DNI, CE, PASAPORTE u OTROS (vacío = DNI)."],
    ["- FECHA_NACIMIENTO: DD/MM/AAAA (también acepta celdas con formato fecha)."],
    ["- SEXO: M o F."],
    ["- CLUB: usa el CÓDIGO o el NOMBRE exacto (ver hoja Clubes)."],
    [
      "- DISCIPLINAS: una o varias separadas por coma (ver hoja Disciplinas). Se cobra una cuota de afiliación por cada una.",
    ],
    [
      "- Si el NRO_DOCUMENTO ya existe, se actualizan sus datos y su club. La vista previa avisa en cada fila que cambia de club.",
    ],
    ["- Máximo 5000 filas y 4 MB por archivo."],
  ])
  notes["!cols"] = [{ wch: 100 }]
  XLSX.utils.book_append_sheet(workbook, notes, "Instrucciones")

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
}

// ==================== PADRÓN: PARSEO ====================

export interface PadronRow {
  rowNumber: number
  firstNames: string
  lastNames: string
  docType: "DNI" | "CE" | "PASAPORTE" | "OTROS"
  docNumber: string
  birthDateISO: string // YYYY-MM-DD
  sex: "M" | "F"
  clubRef: string
  disciplines: DisciplineValue[]
  errors: string[]
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
}

// Cómo puede escribir el usuario cada disciplina en la columna DISCIPLINAS.
// Se comparan normalizados (sin tildes, solo letras), así "Natación Artística",
// "artistica" y "ARTISTICA" caen todas en la misma.
const DISCIPLINE_ALIASES: Record<DisciplineValue, string[]> = {
  DIVING: ["DIVING", "CLAVADOS", "CLAVADO", "SALTOS", "SALTOSORNAMENTALES"],
  ARTISTIC_SWIMMING: [
    "ARTISTICSWIMMING",
    "NATACIONARTISTICA",
    "ARTISTICA",
    "NADOSINCRONIZADO",
    "SINCRONIZADO",
  ],
  WATER_POLO: ["WATERPOLO", "POLOACUATICO", "POLO", "WATERPOLO"],
}

const DISCIPLINE_ALIASES_HELP: Record<DisciplineValue, string> = {
  DIVING: "CLAVADOS · SALTOS · DIVING",
  ARTISTIC_SWIMMING: "ARTISTICA · NATACION ARTISTICA · SINCRONIZADO",
  WATER_POLO: "POLO · POLO ACUATICO · WATER POLO",
}

function parseDisciplines(
  value: unknown
): { disciplines: DisciplineValue[] } | { unknownValues: string[] } {
  const text = String(value ?? "").trim()
  if (!text) return { disciplines: [] }

  const parts = text
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const found = new Set<DisciplineValue>()
  const unknownValues: string[] = []

  for (const part of parts) {
    const normalized = normalizeHeader(part)
    const match = DISCIPLINE_VALUES.find((discipline) =>
      DISCIPLINE_ALIASES[discipline].includes(normalized)
    )
    if (match) found.add(match)
    else unknownValues.push(part)
  }

  if (unknownValues.length > 0) return { unknownValues }

  // Orden estable, el mismo que usa toda la app.
  return { disciplines: DISCIPLINE_VALUES.filter((value) => found.has(value)) }
}

const HEADER_ALIASES: Record<string, string> = {
  NOMBRES: "firstNames",
  NOMBRE: "firstNames",
  APELLIDOS: "lastNames",
  APELLIDO: "lastNames",
  TIPODOCUMENTO: "docType",
  TIPODOC: "docType",
  NRODOCUMENTO: "docNumber",
  NUMERODOCUMENTO: "docNumber",
  DOCUMENTO: "docNumber",
  DNI: "docNumber",
  FECHANACIMIENTO: "birthDate",
  FECHANAC: "birthDate",
  NACIMIENTO: "birthDate",
  SEXO: "sex",
  GENERO: "sex",
  CLUB: "club",
  CODIGOCLUB: "club",
  DISCIPLINAS: "disciplines",
  DISCIPLINA: "disciplines",
  DEPORTE: "disciplines",
  DEPORTES: "disciplines",
}

function parseSex(value: string): "M" | "F" | null {
  const v = value.trim().toUpperCase()
  if (["M", "MASCULINO", "H", "HOMBRE", "V", "VARON", "VARÓN"].includes(v)) return "M"
  if (["F", "FEMENINO", "MUJER", "DAMA"].includes(v)) return "F"
  return null
}

function parseDocType(value: string): PadronRow["docType"] {
  const v = value.trim().toUpperCase()
  if (v === "CE" || v.includes("EXTRANJER")) return "CE"
  if (v.startsWith("PAS")) return "PASAPORTE"
  if (v === "OTROS" || v === "OTRO") return "OTROS"
  return "DNI"
}

function parseBirthDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = value.getMonth() + 1
    const d = value.getDate()
    if (y < 1900 || y > 2100) return null
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    // Serial de Excel (días desde 1900-01-00, con el bug del año bisiesto 1900).
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed || parsed.y < 1900) return null
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`
  }

  const text = String(value ?? "").trim()
  if (!text) return null

  let match = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (match) {
    const [, d, m, y] = match
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }

  match = text.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/)
  if (match) {
    const [, y, m, d] = match
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }

  return null
}

function isValidCalendarDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  )
}

export function parsePadronWorkbook(buffer: Buffer | ArrayBuffer): {
  rows: PadronRow[]
  fileError?: string
} {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true })
  } catch {
    return {
      rows: [],
      fileError:
        "No se pudo leer el archivo. Ábrelo en Excel, guárdalo como .xlsx y vuelve a subirlo.",
    }
  }

  const sheetName =
    workbook.SheetNames.find((n) => normalizeHeader(n) === "PADRON") ??
    workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      rows: [],
      fileError: "El archivo no tiene hojas. Usa la plantilla y copia ahí tus datos.",
    }
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
  })

  if (rawRows.length === 0) {
    return {
      rows: [],
      fileError: `La hoja «${sheetName}» está vacía: copia los deportistas debajo de los encabezados.`,
    }
  }

  // Mapear encabezados reales -> campos conocidos.
  const firstRow = rawRows[0]
  const headerMap = new Map<string, string>()
  for (const key of Object.keys(firstRow)) {
    const alias = HEADER_ALIASES[normalizeHeader(key)]
    if (alias) headerMap.set(alias, key)
  }

  const required = [
    "firstNames",
    "lastNames",
    "docNumber",
    "birthDate",
    "sex",
    "club",
    "disciplines",
  ]
  const missing = required.filter((f) => !headerMap.has(f))
  if (missing.length > 0) {
    const names = missing.map((f) =>
      f === "firstNames" ? "NOMBRES"
      : f === "lastNames" ? "APELLIDOS"
      : f === "docNumber" ? "NRO_DOCUMENTO"
      : f === "birthDate" ? "FECHA_NACIMIENTO"
      : f === "sex" ? "SEXO"
      : f === "disciplines" ? "DISCIPLINAS"
      : "CLUB"
    )
    return {
      rows: [],
      fileError: `${
        names.length === 1 ? `Falta la columna ${names[0]}` : `Faltan las columnas ${names.join(", ")}`
      } en la primera fila de la hoja «${sheetName}». Descarga la plantilla para ver el formato.`,
    }
  }

  const rows: PadronRow[] = []

  rawRows.forEach((raw, index) => {
    const get = (field: string) => {
      const key = headerMap.get(field)
      return key ? raw[key] : ""
    }

    const firstNames = String(get("firstNames") ?? "").trim()
    const lastNames = String(get("lastNames") ?? "").trim()
    const docNumber = String(get("docNumber") ?? "").trim().replace(/\s+/g, "")
    const clubRef = String(get("club") ?? "").trim()
    const sexRaw = String(get("sex") ?? "")
    const docTypeRaw = String(get("docType") ?? "")

    // Filas totalmente vacías se ignoran.
    if (!firstNames && !lastNames && !docNumber && !clubRef) {
      return
    }

    const errors: string[] = []
    if (!firstNames) errors.push("Falta NOMBRES")
    if (!lastNames) errors.push("Falta APELLIDOS")
    if (!docNumber) {
      errors.push("Falta NRO_DOCUMENTO")
    } else if (!/^[a-zA-Z0-9-]{4,20}$/.test(docNumber)) {
      errors.push(
        `NRO_DOCUMENTO «${docNumber}» no es válido: usa de 4 a 20 letras, números o guiones`
      )
    }

    const sex = parseSex(sexRaw)
    if (!sex) {
      errors.push(
        sexRaw.trim() ? `SEXO «${sexRaw.trim()}» no es válido: usa M o F` : "Falta SEXO (usa M o F)"
      )
    }

    const birthDateISO = parseBirthDate(get("birthDate"))
    if (!birthDateISO || !isValidCalendarDate(birthDateISO)) {
      errors.push("FECHA_NACIMIENTO no es una fecha válida: usa DD/MM/AAAA")
    }

    if (!clubRef) errors.push("Falta CLUB")

    // Cada disciplina genera su propia cuota anual, así que no puede quedar vacía.
    const parsedDisciplines = parseDisciplines(get("disciplines"))
    let disciplines: DisciplineValue[] = []
    if ("unknownValues" in parsedDisciplines) {
      const unknown = parsedDisciplines.unknownValues
      errors.push(
        unknown.length === 1
          ? `DISCIPLINAS: «${unknown[0]}» no es una disciplina reconocida (ver hoja Disciplinas)`
          : `DISCIPLINAS: no se reconocen ${unknown.map((value) => `«${value}»`).join(", ")} (ver hoja Disciplinas)`
      )
    } else if (parsedDisciplines.disciplines.length === 0) {
      errors.push("Falta DISCIPLINAS (ver hoja Disciplinas)")
    } else {
      disciplines = parsedDisciplines.disciplines
    }

    rows.push({
      rowNumber: index + 2, // +1 por el encabezado, +1 porque Excel arranca en 1
      firstNames,
      lastNames,
      docType: parseDocType(docTypeRaw),
      docNumber,
      birthDateISO: birthDateISO ?? "",
      sex: sex ?? "M",
      clubRef,
      disciplines,
      errors,
    })
  })

  return { rows }
}

// ==================== REPORTE DE EVENTO ====================

export interface EventReportData {
  eventName: string
  generatedAt: string
  summaryRows: Array<Record<string, unknown>>
  clubRows: Array<Record<string, unknown>>
  nominalRows: Array<Record<string, unknown>>
  athleteFeeRows: Array<Record<string, unknown>>
  orderRows: Array<Record<string, unknown>>
}

export function buildEventReportWorkbook(data: EventReportData): Buffer {
  const workbook = XLSX.utils.book_new()

  const addSheet = (
    name: string,
    rows: Array<Record<string, unknown>>,
    widths?: number[]
  ) => {
    const sheet =
      rows.length > 0
        ? XLSX.utils.json_to_sheet(rows)
        : XLSX.utils.aoa_to_sheet([["Sin datos"]])
    if (widths) {
      sheet["!cols"] = widths.map((wch) => ({ wch }))
    }
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }

  addSheet("Resumen por prueba", data.summaryRows, [18, 24, 26, 10, 10, 12, 12, 12])
  addSheet("Por club", data.clubRows, [32, 14, 14, 14])
  addSheet("Nominal", data.nominalRows, [30, 12, 8, 6, 26, 18, 24, 26, 14, 12])
  // Cuota fija por deportista: en clavados el cobro no está en las pruebas, así
  // que sin esta hoja el Excel no explicaría de dónde sale la recaudación.
  addSheet("Cuotas por deportista", data.athleteFeeRows, [30, 12, 8, 6, 26, 18, 12, 12])
  addSheet("Órdenes", data.orderRows, [14, 32, 20, 12, 12, 12, 20])

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
}

// ==================== REPORTE DEL CLUB ====================

export function buildClubEventReportWorkbook(data: {
  summaryRows: Array<Record<string, unknown>>
  modalityRows: Array<Record<string, unknown>>
  nominalRows: Array<Record<string, unknown>>
  athleteFeeRows: Array<Record<string, unknown>>
  orderRows: Array<Record<string, unknown>>
}): Buffer {
  const workbook = XLSX.utils.book_new()

  const addSheet = (
    name: string,
    rows: Array<Record<string, unknown>>,
    widths: number[]
  ) => {
    const sheet =
      rows.length > 0
        ? XLSX.utils.json_to_sheet(rows)
        : XLSX.utils.aoa_to_sheet([["Sin datos"]])
    sheet["!cols"] = widths.map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }

  addSheet("Resumen", data.summaryRows, [28, 44])
  addSheet("Por prueba", data.modalityRows, [18, 26, 26, 10, 14, 14, 12])
  addSheet("Nominal", data.nominalRows, [30, 14, 8, 6, 18, 26, 26, 12, 16, 12])
  // Solo se agrega si la disciplina cobra cuota fija; si no, la hoja sobra.
  if (data.athleteFeeRows.length > 0) {
    addSheet("Cuotas por deportista", data.athleteFeeRows, [30, 14, 8, 6, 18, 12, 12])
  }
  addSheet("Órdenes", data.orderRows, [16, 20, 14, 14, 14])

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
}

// ==================== AFILIACIONES ====================

export function buildAffiliationsWorkbook(data: {
  clubRows: Array<Record<string, unknown>>
  athleteRows: Array<Record<string, unknown>>
}): Buffer {
  const workbook = XLSX.utils.book_new()

  const addSheet = (
    name: string,
    rows: Array<Record<string, unknown>>,
    widths: number[]
  ) => {
    const sheet =
      rows.length > 0
        ? XLSX.utils.json_to_sheet(rows)
        : XLSX.utils.aoa_to_sheet([["Sin datos"]])
    sheet["!cols"] = widths.map((wch) => ({ wch }))
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }

  addSheet("Clubes", data.clubRows, [32, 14, 20, 18, 22, 14, 12, 10, 18, 24])
  addSheet("Deportistas", data.athleteRows, [30, 14, 12, 10, 30, 20, 18, 18, 14])

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
}
