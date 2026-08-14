// Por qué una formación aparece en S/ 0 en un comprobante o reporte. Módulo
// puro (sin Prisma) a propósito: lo importan `registration-snapshots.ts` y
// `order-summary.ts`, que arman comprobantes desde snapshots congelados y se
// prueban sin base de datos. Si esto viviera en `registration-plans.ts` (que
// sí importa Prisma), esas pruebas puras arrastrarían un PrismaClient real.
//
// Es el criterio único para esta pregunta. `registration-plans.ts` reexporta
// estos nombres para no romper a quien ya los importaba desde ahí.

export type EntryChargeNote = "CHARGED" | "IN_ATHLETE_FEE" | "CLUB_PAYS_PER_ATHLETE"

/**
 * Por qué una formación aparece en S/ 0 en el comprobante. Sin esta nota la
 * línea parecería decir que la prueba fue gratis.
 */
export function entryChargeSuffix(note: EntryChargeNote): string {
  if (note === "IN_ATHLETE_FEE") return " | incluida en la cuota por deportista"
  if (note === "CLUB_PAYS_PER_ATHLETE") return " | sin cargo: el club paga por deportista"
  return ""
}

/**
 * Por que una formacion aparece en S/ 0. El orden importa: si la disciplina no
 * cobra por formacion, ESA es la razon real y gana sobre la eleccion del club,
 * aunque el club tambien se haya bajado del concepto.
 *
 * `chargesEntry` en `undefined` (disciplina ausente del desglose) se trata como
 * `true`: es el comportamiento historico y hoy no puede pasar, porque el motor
 * emite una linea ENTRY por cada formacion.
 */
export function entryChargeNoteFor(input: {
  chargesEntry: boolean
  paysEntry: boolean | null
}): EntryChargeNote {
  if (!input.chargesEntry) return "IN_ATHLETE_FEE"
  if (input.paysEntry === false) return "CLUB_PAYS_PER_ATHLETE"
  return "CHARGED"
}

/**
 * Igual que `entryChargeSuffix`, pero sin el separador `" | "`: para mostrar
 * la nota como texto suelto (badge, línea aparte) en vez de pegada al final
 * de una descripción. Reutiliza `entryChargeSuffix` para no duplicar las
 * frases en dos lugares.
 */
export function entryChargeNoteLabel(note: EntryChargeNote): string {
  return entryChargeSuffix(note).replace(/^ \| /, "")
}

/**
 * Lee, desde la descripcion ya congelada de un OrderItem, la nota que
 * `entryChargeNoteFor` decidio al crear la orden (`buildRegistrationDescription`
 * en `registration-plans.ts` la graba ahi via `entryChargeSuffix`). El snapshot
 * JSON (`RegistrationItemSnapshot`) no guarda `chargesEntry`/`paysEntry`: viven
 * en la config del evento y en la planilla, ninguna de las dos congelada.
 * Releer el sufijo de `description` es releer esa misma decision, no inventar
 * un segundo criterio a partir del importe.
 */
export function entryChargeNoteFromDescription(description: string): EntryChargeNote {
  if (description.endsWith(entryChargeSuffix("IN_ATHLETE_FEE"))) return "IN_ATHLETE_FEE"
  if (description.endsWith(entryChargeSuffix("CLUB_PAYS_PER_ATHLETE"))) {
    return "CLUB_PAYS_PER_ATHLETE"
  }
  return "CHARGED"
}
