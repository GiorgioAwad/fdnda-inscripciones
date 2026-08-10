import { disciplineLabel, sortDisciplines } from "./disciplines"
import { competesUpACategory } from "./eligibility"
import {
  parseAthleteFeeSnapshot,
  parseRegistrationItemSnapshot,
  type AthleteFeeSnapshot,
  type RegistrationItemSnapshot,
} from "./registration-snapshots"
import { birthYearOf, toAmount } from "./utils"

// Arma el comprobante detallado de una orden de inscripción a partir de lo que
// quedó congelado en cada OrderItem. No consulta la base: si el evento se
// renombra o cambia de precio después, el comprobante sigue diciendo lo que el
// club compró.
//
// Es puro para poder probarlo sin base y para reutilizarlo tal cual en el
// resumen imprimible y en el Excel del club.

export interface SummaryAthlete {
  id: string
  name: string
  docType: string
  docNumber: string
  birthYear: number
  sex: "M" | "F"
}

export interface SummaryEntryAthlete extends SummaryAthlete {
  isReserve: boolean
  /** Entró por la regla de "sube de categoría" de natación artística. */
  competesUp: boolean
}

export interface SummaryEntry {
  itemId: string
  modalityName: string
  category: string | null
  sexRule: string
  amount: number
  athletes: SummaryEntryAthlete[]
}

/**
 * Las formaciones con exactamente los mismos deportistas van juntas: el club ve
 * una vez a cada deportista (o a cada dueto/equipo) con todas sus pruebas
 * debajo, en lugar de releer los mismos nombres prueba por prueba.
 */
export interface SummaryRoster {
  /** Estable dentro de la disciplina: los ids de sus deportistas. */
  key: string
  athletes: SummaryAthlete[]
  entries: SummaryEntry[]
  subtotal: number
}

export interface SummaryAthleteFee {
  itemId: string
  athleteName: string
  docType: string
  docNumber: string
  birthYear: number
  sex: "M" | "F"
  amount: number
}

export interface SummaryDiscipline {
  discipline: string
  label: string
  rosters: SummaryRoster[]
  athleteFees: SummaryAthleteFee[]
  /** Deportistas distintos de la disciplina, titulares y reservas. */
  athleteCount: number
  /** Formaciones inscritas, contando cada prueba una vez. */
  entryCount: number
  subtotal: number
}

export interface OrderSummaryEvent {
  name: string
  venue: string | null
  city: string | null
  startDate: string
  endDate: string
  seasonName: string | null
}

export interface OrderSummaryView {
  event: OrderSummaryEvent | null
  clubName: string | null
  disciplines: SummaryDiscipline[]
  /** Ítems sin snapshot legible: se muestran con su descripción original. */
  legacyItems: Array<{ itemId: string; description: string; amount: number }>
  totals: {
    entryCount: number
    athleteCount: number
    athleteFeeCount: number
    amount: number
  }
}

export interface OrderSummaryItem {
  id: string
  description: string
  unitPrice: unknown
  registrationSnapshot?: unknown
}

function athleteOf(
  snapshot: RegistrationItemSnapshot,
  athlete: RegistrationItemSnapshot["registration"]["athletes"][number]
): SummaryEntryAthlete {
  return {
    id: athlete.id,
    name: `${athlete.lastNames}, ${athlete.firstNames}`,
    docType: athlete.docType,
    docNumber: athlete.docNumber,
    birthYear: birthYearOf(athlete.birthDate),
    sex: athlete.sex,
    isReserve: athlete.isReserve,
    competesUp: competesUpACategory(
      {
        sexRule: "ANY",
        birthYearFrom: snapshot.modality.birthYearFrom,
        birthYearTo: snapshot.modality.birthYearTo,
        upgradeYear: snapshot.modality.allowsCategoryUpgrade
          ? snapshot.modality.categoryUpgradeBirthYear
          : null,
        minAthletes: snapshot.modality.minAthletes,
        maxAthletes: snapshot.modality.maxAthletes,
        name: snapshot.modality.name,
      },
      { ...athlete, birthDate: athlete.birthDate }
    ),
  }
}

/**
 * Dos formaciones son "la misma gente" si tienen el mismo conjunto de
 * deportistas, sin importar el orden en que los guardó el snapshot. Una entry
 * sin deportistas (dato viejo) se queda sola: nadie con quien juntarla.
 */
function rosterKeyOf(entry: SummaryEntry): string {
  if (entry.athletes.length === 0) return `item:${entry.itemId}`
  return entry.athletes
    .map((athlete) => athlete.id)
    .sort()
    .join("|")
}

function rosterLabelOf(roster: SummaryRoster): string {
  return roster.athletes.map((athlete) => athlete.name).join(" · ")
}

function groupIntoRosters(entries: readonly SummaryEntry[]): SummaryRoster[] {
  const byRoster = new Map<string, SummaryRoster>()

  for (const entry of entries) {
    const key = rosterKeyOf(entry)
    const roster = byRoster.get(key)
    if (roster) {
      roster.entries.push(entry)
      roster.subtotal += entry.amount
      continue
    }
    byRoster.set(key, {
      key,
      // El orden del snapshot (titulares y luego reservas) manda; los avisos de
      // reserva y ascenso viven en cada entry porque cambian de prueba a prueba.
      athletes: entry.athletes.map((athlete) => ({
        id: athlete.id,
        name: athlete.name,
        docType: athlete.docType,
        docNumber: athlete.docNumber,
        birthYear: athlete.birthYear,
        sex: athlete.sex,
      })),
      entries: [entry],
      subtotal: entry.amount,
    })
  }

  const rosters = [...byRoster.values()]
  for (const roster of rosters) {
    roster.entries.sort(
      (a, b) =>
        a.modalityName.localeCompare(b.modalityName) ||
        (a.category ?? "").localeCompare(b.category ?? "")
    )
  }
  rosters.sort((a, b) => rosterLabelOf(a).localeCompare(rosterLabelOf(b)))
  return rosters
}

function eventOf(
  snapshot: RegistrationItemSnapshot | AthleteFeeSnapshot
): OrderSummaryEvent {
  return {
    name: snapshot.event.name,
    venue: snapshot.event.venue,
    city: snapshot.event.city,
    startDate: snapshot.event.startDate,
    endDate: snapshot.event.endDate,
    seasonName: snapshot.event.season?.name ?? null,
  }
}

export function buildOrderSummary(
  items: readonly OrderSummaryItem[]
): OrderSummaryView {
  const byDiscipline = new Map<string, SummaryDiscipline>()
  const legacyItems: OrderSummaryView["legacyItems"] = []
  const athletesByDiscipline = new Map<string, Set<string>>()
  // Las entries se juntan por formación recién al final, cuando ya llegaron
  // todos los ítems de la disciplina.
  const entriesByDiscipline = new Map<string, SummaryEntry[]>()
  let event: OrderSummaryEvent | null = null
  let clubName: string | null = null
  let amount = 0

  const bucketFor = (discipline: string): SummaryDiscipline => {
    const existing = byDiscipline.get(discipline)
    if (existing) return existing
    const created: SummaryDiscipline = {
      discipline,
      label: disciplineLabel(discipline),
      rosters: [],
      athleteFees: [],
      athleteCount: 0,
      entryCount: 0,
      subtotal: 0,
    }
    byDiscipline.set(discipline, created)
    athletesByDiscipline.set(discipline, new Set())
    entriesByDiscipline.set(discipline, [])
    return created
  }

  for (const item of items) {
    const itemAmount = toAmount(item.unitPrice)
    amount += itemAmount

    const fee = parseAthleteFeeSnapshot(item.registrationSnapshot)
    if (fee) {
      event ??= eventOf(fee)
      clubName ??= fee.club.name
      const bucket = bucketFor(fee.discipline)
      bucket.athleteFees.push({
        itemId: item.id,
        athleteName: `${fee.athlete.lastNames}, ${fee.athlete.firstNames}`,
        docType: fee.athlete.docType,
        docNumber: fee.athlete.docNumber,
        birthYear: birthYearOf(fee.athlete.birthDate),
        sex: fee.athlete.sex,
        amount: itemAmount,
      })
      bucket.subtotal += itemAmount
      athletesByDiscipline.get(fee.discipline)!.add(fee.athlete.id)
      continue
    }

    const snapshot = parseRegistrationItemSnapshot(item.registrationSnapshot)
    if (!snapshot) {
      legacyItems.push({
        itemId: item.id,
        description: item.description,
        amount: itemAmount,
      })
      continue
    }

    event ??= eventOf(snapshot)
    clubName ??= snapshot.club.name
    const bucket = bucketFor(snapshot.modality.discipline)
    entriesByDiscipline.get(snapshot.modality.discipline)!.push({
      itemId: item.id,
      modalityName: snapshot.modality.name,
      category: snapshot.modality.category,
      sexRule: snapshot.modality.sexRule,
      amount: itemAmount,
      athletes: snapshot.registration.athletes.map((athlete) =>
        athleteOf(snapshot, athlete)
      ),
    })
    bucket.subtotal += itemAmount
    const seen = athletesByDiscipline.get(snapshot.modality.discipline)!
    for (const athlete of snapshot.registration.athletes) seen.add(athlete.id)
  }

  for (const [discipline, athletes] of athletesByDiscipline) {
    byDiscipline.get(discipline)!.athleteCount = athletes.size
  }

  // Orden estable de disciplinas; dentro, por deportista y luego por prueba.
  const ordered = sortDisciplines([...byDiscipline.keys()])
    .map((discipline) => byDiscipline.get(discipline)!)
    .concat(
      // Disciplinas desconocidas (datos viejos) al final, sin perderlas.
      [...byDiscipline.entries()]
        .filter(([key]) => !sortDisciplines([key]).length)
        .map(([, value]) => value)
    )

  for (const bucket of ordered) {
    const entries = entriesByDiscipline.get(bucket.discipline)!
    bucket.rosters = groupIntoRosters(entries)
    bucket.entryCount = entries.length
    bucket.athleteFees.sort((a, b) => a.athleteName.localeCompare(b.athleteName))
  }

  const allAthletes = new Set(
    [...athletesByDiscipline.values()].flatMap((set) => [...set])
  )

  return {
    event,
    clubName,
    disciplines: ordered,
    legacyItems,
    totals: {
      entryCount: ordered.reduce((sum, row) => sum + row.entryCount, 0),
      athleteCount: allAthletes.size,
      athleteFeeCount: ordered.reduce(
        (sum, row) => sum + row.athleteFees.length,
        0
      ),
      amount,
    },
  }
}
