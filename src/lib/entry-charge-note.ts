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
 * Igual que `entryChargeNoteFor`, pero a partir del resumen por disciplina
 * (`DisciplinePricingSummary` de event-pricing.ts) en vez de cruzar la config
 * cruda del evento (`chargesEntry`) contra la elección cruda de la planilla
 * (`plan.paysEntry`). Ese cruce directo no sabe si la disciplina ofrece
 * elegir: en una disciplina de un solo concepto apaga la formación aunque el
 * club nunca haya podido elegir ahí (el bug que esto reemplaza).
 *
 * `chargedEntry` ya resolvió esa guarda -está acotada a las disciplinas que
 * cobran los dos conceptos a la vez, ver `appliedCharges` en event-pricing.ts-
 * así que alcanza con pasarla donde antes iba `paysEntry`: cuando
 * `chargesEntry` es cierto, `chargedEntry` solo es falso si la disciplina
 * ofrecía elegir y el club se bajó de ese concepto, que es exactamente cuándo
 * corresponde `CLUB_PAYS_PER_ATHLETE`.
 *
 * Default para una disciplina ausente del desglose: `true` en los dos campos,
 * igual que el default histórico de `entryChargeNoteFor` (hoy no debería
 * pasar, porque el motor emite una línea ENTRY por cada formación).
 */
export function entryChargeNoteForDiscipline(input: {
  chargesEntry: boolean
  chargedEntry: boolean
}): EntryChargeNote {
  return entryChargeNoteFor({
    chargesEntry: input.chargesEntry,
    paysEntry: input.chargedEntry,
  })
}

/**
 * La misma nota, redactada para mostrarse suelta (badge, línea aparte) en una
 * planilla o constancia. No reutiliza `entryChargeSuffix`: ese sufijo queda
 * grabado en la descripción de cada OrderItem y `entryChargeNoteFromDescription`
 * lo vuelve a leer, así que no puede cambiar sin romper las órdenes históricas.
 * Esta frase sí puede seguir el glosario del portal.
 */
export function entryChargeNoteLabel(note: EntryChargeNote): string {
  if (note === "IN_ATHLETE_FEE") {
    return "Incluida en la cuota de competencia por deportista"
  }
  if (note === "CLUB_PAYS_PER_ATHLETE") {
    return "Sin cargo: tu club eligió pagar la cuota de competencia por deportista"
  }
  return ""
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
