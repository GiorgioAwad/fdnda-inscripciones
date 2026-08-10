import {
  athleteEligibilityError,
  competesUpACategory,
  validateEntryComposition,
} from "./eligibility"
import { disciplineLabel, type DisciplineValue } from "./disciplines"
import { SEX_RULE_LABELS } from "./utils"

// Modelo compartido entre el armador de inscripciones (cliente) y la hoja de
// resumen (servidor). Son datos planos a propósito: las mismas funciones puras
// validan mientras el club arma sus entries y cuando el servidor las guarda, así
// la pantalla nunca promete algo que el servidor luego rechaza.

export type SexRuleValue = "MALE" | "FEMALE" | "MIXED" | "ANY"
export type EntryStatus = "IN_CART" | "PENDING_PAYMENT" | "PAID"

export interface PlanModality {
  id: string
  discipline: DisciplineValue
  name: string
  category: string
  sexRule: SexRuleValue
  birthYearFrom: number | null
  birthYearTo: number | null
  // Año extra por "sube de categoría" (ver upgradeBirthYearFor en lib/categories).
  upgradeYear: number | null
  // Nombre de la categoría de la que suben, solo para rotular.
  upgradeFromCategory: string | null
  minAthletes: number
  maxAthletes: number
  price: number
  capacity: number | null
  // Inscripciones de la prueba que NO se reemplazan al guardar: las de otros
  // clubes y las propias que ya salieron del carrito. Sumadas a las entries
  // marcadas isNew dan el total frente al cupo.
  registrationCount: number
}

export interface PlanAthlete {
  id: string
  firstNames: string
  lastNames: string
  docType: string
  docNumber: string
  // ISO: los datos cruzan al cliente serializados.
  birthDate: string
  birthYear: number
  sex: "M" | "F"
  // Disciplinas del padrón: definen en qué pruebas puede aparecer.
  disciplines: DisciplineValue[]
  // Disciplinas con afiliación vigente: sin ella la inscripción se bloquea.
  affiliatedIn: DisciplineValue[]
  // Categoría que le corresponde por año de nacimiento, por disciplina.
  categoryByDiscipline: Partial<Record<DisciplineValue, string>>
}

export interface PlanEntry {
  // Id de la inscripción existente o clave temporal del armador.
  key: string
  modalityId: string
  athleteIds: string[]
  reserveIds: string[]
  status: EntryStatus
  // Creada en esta sesión del armador: todavía no cuenta en registrationCount,
  // así que es la que puede pasarse del cupo.
  isNew?: boolean
}

export interface SummaryIssue {
  level: "error" | "warning"
  message: string
}

// Una prueba por plantel/dueto: se arma eligiendo integrantes, no marcando una
// casilla por deportista.
export function isTeamModality(modality: PlanModality): boolean {
  return modality.maxAthletes > 1
}

// Solo se pueden editar las que siguen en el carrito: las que ya entraron a una
// orden se muestran para que el total del evento sea el real.
export function isEditable(entry: PlanEntry): boolean {
  return entry.status === "IN_CART"
}

export function modalityLabel(modality: PlanModality): string {
  return [modality.name, modality.category].filter(Boolean).join(" — ")
}

export function athleteName(athlete: PlanAthlete): string {
  return `${athlete.lastNames}, ${athlete.firstNames}`
}

export function yearRangeLabel(from: number | null, to: number | null): string {
  if (from === null && to === null) return "Todos los años"
  if (from !== null && to !== null) return `Nacidos ${from}–${to}`
  if (from !== null) return `Nacidos desde ${from}`
  return `Nacidos hasta ${to}`
}

// Etiqueta del permiso de subir de categoría, para chips y leyendas.
export function upgradeLabel(modality: PlanModality): string | null {
  if (modality.upgradeYear === null) return null
  return modality.upgradeFromCategory
    ? `Admite el último año de ${modality.upgradeFromCategory} (${modality.upgradeYear})`
    : `Admite el último año de la categoría inferior (${modality.upgradeYear})`
}

// Motivo por el que un deportista no puede entrar a una prueba, o null si puede.
// Cubre las tres razones del negocio: no practica la disciplina, no tiene la
// afiliación vigente de esa disciplina y no cumple edad/sexo.
export function athleteBlockedReason(
  modality: PlanModality,
  athlete: PlanAthlete
): string | null {
  if (!athlete.disciplines.includes(modality.discipline)) {
    return `No tiene ${disciplineLabel(modality.discipline)} registrada en el padrón`
  }
  if (!athlete.affiliatedIn.includes(modality.discipline)) {
    return `Sin afiliación vigente de ${disciplineLabel(modality.discipline)}`
  }
  return athleteEligibilityError(modality, athlete)
}

export function canEnter(modality: PlanModality, athlete: PlanAthlete): boolean {
  return athleteBlockedReason(modality, athlete) === null
}

export function entersByUpgrade(
  modality: PlanModality,
  athlete: PlanAthlete
): boolean {
  return competesUpACategory(modality, athlete)
}

// ==================== RESUMEN ====================

export interface ModalityEntryRow {
  entry: PlanEntry
  modality: PlanModality
  athletes: PlanAthlete[]
  reserves: PlanAthlete[]
  upgraded: PlanAthlete[]
  issues: SummaryIssue[]
}

export interface ModalitySummaryRow {
  modality: PlanModality
  entries: ModalityEntryRow[]
  subtotal: number
}

export interface DisciplineSummaryRow {
  discipline: DisciplineValue
  label: string
  modalities: ModalitySummaryRow[]
  entryCount: number
  subtotal: number
}

export interface AthleteEntryRef {
  entryKey: string
  modality: PlanModality
  status: EntryStatus
  isReserve: boolean
  upgraded: boolean
}

export interface AthleteSummaryRow {
  athlete: PlanAthlete
  entries: AthleteEntryRef[]
}

export interface EntrySummary {
  byDiscipline: DisciplineSummaryRow[]
  byAthlete: AthleteSummaryRow[]
  // Deportistas elegidos que se quedaron sin ninguna prueba.
  athletesWithoutEntries: PlanAthlete[]
  entryCount: number
  editableCount: number
  athleteCount: number
  total: number
  // Lo que falta pagar: las entries que siguen en el carrito.
  payable: number
  errors: SummaryIssue[]
  warnings: SummaryIssue[]
  isValid: boolean
}

export function buildEntrySummary(input: {
  modalities: PlanModality[]
  athletes: PlanAthlete[]
  entries: PlanEntry[]
  // Deportistas marcados en el armador: los que quedan sin prueba se avisan.
  selectedAthleteIds?: string[]
}): EntrySummary {
  const modalityById = new Map(input.modalities.map((m) => [m.id, m]))
  const athleteById = new Map(input.athletes.map((a) => [a.id, a]))

  const errors: SummaryIssue[] = []
  const warnings: SummaryIssue[] = []

  const rowsByModality = new Map<string, ModalityEntryRow[]>()
  const refsByAthlete = new Map<string, AthleteEntryRef[]>()

  for (const entry of input.entries) {
    const modality = modalityById.get(entry.modalityId)
    if (!modality) continue

    const reserveIds = new Set(entry.reserveIds)
    const athletes: PlanAthlete[] = []
    const reserves: PlanAthlete[] = []
    const upgraded: PlanAthlete[] = []
    const issues: SummaryIssue[] = []

    for (const athleteId of entry.athleteIds) {
      const athlete = athleteById.get(athleteId)
      if (!athlete) {
        issues.push({
          level: "error",
          message: "Un deportista de esta inscripción ya no está en tu padrón.",
        })
        continue
      }
      athletes.push(athlete)
      if (reserveIds.has(athleteId)) reserves.push(athlete)
      if (entersByUpgrade(modality, athlete)) upgraded.push(athlete)

      const ref: AthleteEntryRef = {
        entryKey: entry.key,
        modality,
        status: entry.status,
        isReserve: reserveIds.has(athleteId),
        upgraded: entersByUpgrade(modality, athlete),
      }
      const refs = refsByAthlete.get(athleteId) ?? []
      refs.push(ref)
      refsByAthlete.set(athleteId, refs)
    }

    // Las que ya están pagadas o en una orden no se revalidan: se emitieron con
    // las reglas vigentes en su momento y no se pueden corregir desde acá.
    if (isEditable(entry)) {
      for (const error of validateEntryComposition(modality, athletes)) {
        issues.push({ level: "error", message: error })
      }
      for (const athlete of athletes) {
        if (!athlete.disciplines.includes(modality.discipline)) {
          issues.push({
            level: "error",
            message: `${athleteName(athlete)}: no tiene ${disciplineLabel(modality.discipline)} registrada en el padrón.`,
          })
        } else if (!athlete.affiliatedIn.includes(modality.discipline)) {
          issues.push({
            level: "error",
            message: `${athleteName(athlete)}: sin afiliación vigente de ${disciplineLabel(modality.discipline)}.`,
          })
        }
      }
    }

    for (const athlete of upgraded) {
      warnings.push({
        level: "warning",
        message: `${athleteName(athlete)} (${athlete.birthYear}) compite en categoría superior en ${modalityLabel(modality)}${
          modality.upgradeFromCategory ? `: sube desde ${modality.upgradeFromCategory}` : ""
        }.`,
      })
    }

    const rows = rowsByModality.get(modality.id) ?? []
    rows.push({ entry, modality, athletes, reserves, upgraded, issues })
    rowsByModality.set(modality.id, rows)
  }

  // Un deportista no puede repetirse en una prueba, ni siquiera en dos entries
  // distintas del mismo club (el unique (modalityId, athleteId) lo impide en la
  // base; acá se avisa antes de llegar al error).
  for (const [modalityId, rows] of rowsByModality) {
    const modality = modalityById.get(modalityId)!
    const seen = new Map<string, number>()
    for (const row of rows) {
      for (const athlete of row.athletes) {
        seen.set(athlete.id, (seen.get(athlete.id) ?? 0) + 1)
      }
    }
    for (const [athleteId, count] of seen) {
      if (count > 1) {
        errors.push({
          level: "error",
          message: `${athleteName(athleteById.get(athleteId)!)} aparece ${count} veces en ${modalityLabel(modality)}.`,
        })
      }
    }

    if (modality.capacity !== null) {
      // El cupo cuenta lo ya inscrito por todos los clubes más lo que este club
      // suma ahora (sus entries existentes ya están dentro de registrationCount).
      const nuevas = rows.filter((row) => row.entry.isNew).length
      if (modality.registrationCount + nuevas > modality.capacity) {
        errors.push({
          level: "error",
          message: `${modalityLabel(modality)} llegó a su cupo (${modality.capacity}).`,
        })
      }
    }
  }

  const byDiscipline: DisciplineSummaryRow[] = []
  for (const modality of input.modalities) {
    const rows = rowsByModality.get(modality.id)
    if (!rows || rows.length === 0) continue

    const subtotal = rows.length * modality.price
    let group = byDiscipline.find((g) => g.discipline === modality.discipline)
    if (!group) {
      group = {
        discipline: modality.discipline,
        label: disciplineLabel(modality.discipline),
        modalities: [],
        entryCount: 0,
        subtotal: 0,
      }
      byDiscipline.push(group)
    }
    group.modalities.push({ modality, entries: rows, subtotal })
    group.entryCount += rows.length
    group.subtotal += subtotal
  }

  const byAthlete: AthleteSummaryRow[] = input.athletes
    .filter((athlete) => (refsByAthlete.get(athlete.id)?.length ?? 0) > 0)
    .map((athlete) => ({
      athlete,
      entries: refsByAthlete.get(athlete.id) ?? [],
    }))

  const selected = new Set(input.selectedAthleteIds ?? [])
  const athletesWithoutEntries = input.athletes.filter(
    (athlete) => selected.has(athlete.id) && !refsByAthlete.has(athlete.id)
  )
  for (const athlete of athletesWithoutEntries) {
    warnings.push({
      level: "warning",
      message: `${athleteName(athlete)} está seleccionado pero no compite en ninguna prueba.`,
    })
  }

  for (const rows of rowsByModality.values()) {
    for (const row of rows) errors.push(...row.issues.filter((i) => i.level === "error"))
  }

  const entries = input.entries.filter((entry) => modalityById.has(entry.modalityId))
  const total = entries.reduce(
    (sum, entry) => sum + (modalityById.get(entry.modalityId)?.price ?? 0),
    0
  )
  const payable = entries
    .filter((entry) => entry.status === "IN_CART")
    .reduce((sum, entry) => sum + (modalityById.get(entry.modalityId)?.price ?? 0), 0)

  return {
    byDiscipline,
    byAthlete,
    athletesWithoutEntries,
    entryCount: entries.length,
    editableCount: entries.filter(isEditable).length,
    athleteCount: refsByAthlete.size,
    total,
    payable,
    errors,
    warnings,
    isValid: errors.length === 0,
  }
}

// Descripción de una prueba para leyendas y tooltips.
export function modalityRules(modality: PlanModality): string {
  const size =
    modality.minAthletes === modality.maxAthletes
      ? `${modality.minAthletes} deportista(s)`
      : `${modality.minAthletes} a ${modality.maxAthletes} deportistas`
  return [
    SEX_RULE_LABELS[modality.sexRule],
    yearRangeLabel(modality.birthYearFrom, modality.birthYearTo),
    size,
  ].join(" · ")
}
