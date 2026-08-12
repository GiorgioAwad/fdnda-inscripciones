# Polo: dos conceptos de cobro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un evento pueda cobrar la inscripción de la formación **y** una cuota por deportista al mismo tiempo, y que el club elija cuáles de los dos paga.

**Architecture:** `EventDisciplineConfig.pricingMode` (interruptor excluyente) se reemplaza por dos banderas independientes, `chargesEntry` y `chargesAthleteFee`. La elección del club vive en `RegistrationPlan.paysEntry` / `paysAthleteFee`, anulables, donde `null` significa "lo que diga el evento". El motor de precios multiplica las dos condiciones. `pricingMode` se borra en una release posterior (Task 9) porque Vercel corre las migraciones durante el build y borrarla de una vez tumba las instancias viejas.

**Tech Stack:** Next.js (App Router, server actions), Prisma 7 + PostgreSQL (Neon), Zod, Vitest, Tailwind.

## Global Constraints

- **Ausencia de fila `EventDisciplineConfig` = cobra por formación, `RANGE`.** Los defaults de las columnas nuevas (`chargesEntry=true`, `chargesAthleteFee=false`) existen para conservar esto. Ningún evento anterior puede cambiar de precio.
- **`null` en `paysEntry`/`paysAthleteFee` significa "lo que diga el evento"**, nunca "no paga". Solo un `false` explícito quita el cobro.
- **La línea `ENTRY` de cada formación se emite siempre, aunque valga 0.** Es el registro nominal congelado del que viven los reportes y la constancia.
- **Los snapshots congelados (`registrationSnapshot`) no se tocan nunca.** Son la evidencia de lo que se cobró.
- Comentarios y mensajes de usuario en español. Los mensajes de commit del repo van sin tildes.
- No usar `Prisma.Decimal` en props que crucen a un componente cliente: no sobrevive el límite servidor→cliente.
- Correr `npm test` (Vitest) tras cada tarea; `npm run check` antes del último commit.

---

## File Structure

**Se modifican:**
- `prisma/schema.prisma` — dos columnas en `EventDisciplineConfig`, dos en `RegistrationPlan`
- `src/lib/event-pricing.ts` — el motor; deja de hablar de "modos"
- `src/lib/plan-validation.ts` — pasa la elección al motor y agrega un error
- `src/lib/event-presets.ts` — cada disciplina declara qué cobra
- `src/lib/registration-plans.ts` — nueva mutación + nota del ítem de orden
- `src/app/admin/eventos/actions.ts` — schema Zod y guardado de la config
- `src/app/admin/eventos/event-form-dialog.tsx` — dos casillas en vez de un desplegable
- `src/app/admin/eventos/[id]/page.tsx` — lee las banderas nuevas
- `src/app/(portal)/inscripciones/types.ts` — vistas
- `src/app/(portal)/inscripciones/[planId]/page.tsx` — mapeo
- `src/app/(portal)/inscripciones/actions.ts` — nueva server action
- `src/app/(portal)/inscripciones/[planId]/registration-plan-wizard.tsx` — estado y cableado
- `src/app/(portal)/inscripciones/[planId]/athlete-board.tsx` — monta la tarjeta nueva
- `src/app/(portal)/inscripciones/[planId]/team-formation-panel.tsx` — la nota de precio

**Se crean:**
- `prisma/migrations/20260812120000_cobros_por_concepto/migration.sql`
- `prisma/migrations/20260819120000_retirar_pricing_mode/migration.sql` (Task 9, release siguiente)
- `src/app/(portal)/inscripciones/[planId]/charge-selection-card.tsx` — la tarjeta donde el club elige

---

### Task 1: Esquema y migración

**Files:**
- Modify: `prisma/schema.prisma:364-382` (`EventDisciplineConfig`), `prisma/schema.prisma:512+` (`RegistrationPlan`)
- Create: `prisma/migrations/20260812120000_cobros_por_concepto/migration.sql`

**Interfaces:**
- Consumes: nada
- Produces: columnas `EventDisciplineConfig.chargesEntry: Boolean`, `EventDisciplineConfig.chargesAthleteFee: Boolean`, `RegistrationPlan.paysEntry: Boolean?`, `RegistrationPlan.paysAthleteFee: Boolean?`. `pricingMode` **sigue existiendo** y nadie la lee después de la Task 3.

- [ ] **Step 1: Agregar las columnas al modelo `EventDisciplineConfig`**

En `prisma/schema.prisma`, dentro de `model EventDisciplineConfig`, reemplazar el bloque de `pricingMode` por:

```prisma
  // Los dos conceptos son independientes y pueden estar prendidos a la vez:
  // polo cobra la inscripcion del plantel Y una cuota por jugador. Los defaults
  // son el comportamiento historico, que es lo que hace que un evento sin fila
  // en esta tabla siga cobrando por formacion.
  chargesEntry      Boolean     @default(true)
  chargesAthleteFee Boolean     @default(false)
  // Se retira en la release siguiente: durante el despliegue conviven
  // instancias viejas que todavia la leen.
  pricingMode PricingMode @default(PER_ENTRY)
  // Cuota fija por deportista. Requerida (y > 0) cuando chargesAthleteFee.
  athleteFee  Decimal?    @db.Decimal(10, 2)
  ageRuleMode AgeRuleMode @default(RANGE)
```

- [ ] **Step 2: Agregar las columnas al modelo `RegistrationPlan`**

En `model RegistrationPlan`, después de `disciplineScope`:

```prisma
  // Que conceptos eligio pagar el club. null = lo que diga el evento; solo un
  // false explicito quita el cobro. La eleccion es una por planilla porque la
  // planilla ya esta acotada a un evento y a una disciplina.
  paysEntry      Boolean?
  paysAthleteFee Boolean?
```

- [ ] **Step 3: Escribir la migración**

Crear `prisma/migrations/20260812120000_cobros_por_concepto/migration.sql`:

```sql
-- Dos conceptos de cobro independientes en vez de un modo excluyente.
ALTER TABLE "event_discipline_configs"
  ADD COLUMN "chargesEntry"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "chargesAthleteFee" BOOLEAN NOT NULL DEFAULT false;

-- Backfill desde el modo excluyente. Los eventos SIN fila no necesitan nada:
-- el default de las columnas es exactamente su comportamiento historico.
UPDATE "event_discipline_configs" SET
  "chargesEntry"      = ("pricingMode" = 'PER_ENTRY'),
  "chargesAthleteFee" = ("pricingMode" = 'PER_ATHLETE');

-- Que conceptos eligio pagar el club en cada planilla.
ALTER TABLE "registration_plans"
  ADD COLUMN "paysEntry"      BOOLEAN,
  ADD COLUMN "paysAthleteFee" BOOLEAN;
```

- [ ] **Step 4: Aplicar la migración y regenerar el cliente**

Run: `npx prisma migrate dev --name cobros_por_concepto` (si pregunta por crear la migración, ya existe: usar `npx prisma migrate deploy && npx prisma generate`)
Expected: la migración aplica sin errores y `npx prisma validate` pasa.

- [ ] **Step 5: Verificar el backfill contra la base local**

Crear el archivo temporal `scripts/tmp-verify-cobros.ts`:

```ts
import { prisma } from "@/lib/prisma"

async function main() {
  const rows = await prisma.eventDisciplineConfig.findMany({
    select: {
      discipline: true,
      pricingMode: true,
      chargesEntry: true,
      chargesAthleteFee: true,
    },
  })
  const malas = rows.filter(
    (row) =>
      row.chargesEntry !== (row.pricingMode === "PER_ENTRY") ||
      row.chargesAthleteFee !== (row.pricingMode === "PER_ATHLETE")
  )
  console.log(`${rows.length} filas, ${malas.length} mal mapeadas`)
  if (malas.length > 0) {
    console.error(malas)
    process.exit(1)
  }
}

void main().finally(() => prisma.$disconnect())
```

Run: `npx tsx scripts/tmp-verify-cobros.ts`
Expected: `N filas, 0 mal mapeadas`. Borrar el archivo después: `rm scripts/tmp-verify-cobros.ts`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260812120000_cobros_por_concepto
git commit -m "Dos conceptos de cobro: columnas y backfill desde pricingMode"
```

---

### Task 2: `disciplineConfigFor` devuelve las dos banderas

**Files:**
- Modify: `src/lib/event-pricing.ts:13-121`
- Test: `src/lib/event-pricing.test.ts:1-131`

**Interfaces:**
- Consumes: nada de tareas anteriores (función pura)
- Produces:
  ```ts
  export interface EventDisciplineConfigLike {
    discipline: string
    chargesEntry: boolean
    chargesAthleteFee: boolean
    athleteFee: unknown
    ageRuleMode: string
  }
  export interface EffectiveDisciplineConfig {
    discipline: DisciplineValue
    chargesEntry: boolean
    chargesAthleteFee: boolean
    athleteFee: string | null
    ageRuleMode: AgeRuleModeValue
  }
  export function disciplineConfigFor(
    configs: readonly EventDisciplineConfigLike[],
    discipline: string
  ): EffectiveDisciplineConfig
  export function isPricingConfigurationValid(config: EffectiveDisciplineConfig): boolean
  ```
  El tipo `PricingModeValue` y la constante `DEFAULT_PRICING_MODE` **desaparecen**.

- [ ] **Step 1: Escribir los tests que fallan**

En `src/lib/event-pricing.test.ts`, reemplazar los objetos `perAthlete` y `subN` del encabezado y el bloque `describe("disciplineConfigFor")` y `describe("isPricingConfigurationValid")` por:

```ts
const soloCuota = {
  discipline: "DIVING",
  chargesEntry: false,
  chargesAthleteFee: true,
  athleteFee: "80.00",
  ageRuleMode: "RANGE",
}

const subN = {
  discipline: "WATER_POLO",
  chargesEntry: true,
  chargesAthleteFee: false,
  athleteFee: null,
  ageRuleMode: "MAX_AGE_ONLY",
}

const poloAmbos = {
  discipline: "WATER_POLO",
  chargesEntry: true,
  chargesAthleteFee: true,
  athleteFee: "60.00",
  ageRuleMode: "MAX_AGE_ONLY",
}

describe("disciplineConfigFor", () => {
  it("sin fila devuelve el default histórico: los eventos previos no cambian", () => {
    expect(disciplineConfigFor([], "DIVING")).toEqual({
      discipline: "DIVING",
      chargesEntry: true,
      chargesAthleteFee: false,
      athleteFee: null,
      ageRuleMode: "RANGE",
    })
  })

  it("no mezcla disciplinas: una config de clavados no aplica a polo", () => {
    const config = disciplineConfigFor([soloCuota], "WATER_POLO")
    expect(config.chargesEntry).toBe(true)
    expect(config.chargesAthleteFee).toBe(false)
  })

  it("lee la cuota fija de una disciplina que cobra por deportista", () => {
    const config = disciplineConfigFor([soloCuota], "DIVING")
    expect(config.chargesAthleteFee).toBe(true)
    expect(config.athleteFee).toBe("80.00")
  })

  it("polo puede cobrar los dos conceptos a la vez", () => {
    const config = disciplineConfigFor([poloAmbos], "WATER_POLO")
    expect(config.chargesEntry).toBe(true)
    expect(config.chargesAthleteFee).toBe(true)
    expect(config.athleteFee).toBe("60.00")
  })

  it("ignora una cuota residual cuando ya no se cobra por deportista", () => {
    const config = disciplineConfigFor(
      [{ ...soloCuota, chargesAthleteFee: false, chargesEntry: true }],
      "DIVING"
    )
    expect(config.athleteFee).toBeNull()
  })

  it("trata una regla de edad desconocida como el default en vez de romper", () => {
    const config = disciplineConfigFor(
      [{ ...subN, ageRuleMode: "OTRA_COSA" }],
      "WATER_POLO"
    )
    expect(config.ageRuleMode).toBe("RANGE")
  })
})

describe("isPricingConfigurationValid", () => {
  it("acepta una disciplina que solo cobra por formación", () => {
    expect(
      isPricingConfigurationValid(disciplineConfigFor([], "ARTISTIC_SWIMMING"))
    ).toBe(true)
  })

  it("rechaza cobrar por deportista sin cuota", () => {
    expect(
      isPricingConfigurationValid(
        disciplineConfigFor([{ ...soloCuota, athleteFee: null }], "DIVING")
      )
    ).toBe(false)
  })

  it("rechaza cobrar por deportista con cuota cero", () => {
    expect(
      isPricingConfigurationValid(
        disciplineConfigFor([{ ...soloCuota, athleteFee: "0" }], "DIVING")
      )
    ).toBe(false)
  })

  it("rechaza polo con los dos conceptos si la cuota falta", () => {
    expect(
      isPricingConfigurationValid(
        disciplineConfigFor([{ ...poloAmbos, athleteFee: null }], "WATER_POLO")
      )
    ).toBe(false)
  })
})
```

En el mismo archivo, actualizar el resto de las referencias: `describe("regla de edad Sub-N")` usa `disciplineConfigFor([subN], "WATER_POLO")` (ya funciona) y `DIVING_FLAT` pasa a ser:

```ts
const DIVING_FLAT: EventDisciplineConfigLike[] = [
  {
    discipline: "DIVING",
    chargesEntry: false,
    chargesAthleteFee: true,
    athleteFee: "80.00",
    ageRuleMode: "RANGE",
  },
]
```

Quitar `PricingModeValue` del `import` si aparece.

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run src/lib/event-pricing.test.ts`
Expected: FAIL — `chargesEntry` no existe en el objeto devuelto.

- [ ] **Step 3: Reescribir la cabecera de `event-pricing.ts`**

Reemplazar desde la línea 13 (`export type PricingModeValue`) hasta el final de `isPricingConfigurationValid` por:

```ts
export type AgeRuleModeValue = "RANGE" | "MAX_AGE_ONLY"

export const DEFAULT_AGE_RULE_MODE: AgeRuleModeValue = "RANGE"

// Forma mínima que necesita este módulo. Se declara acá en vez de importar el
// tipo de Prisma para que las funciones puras sigan siendo testeables sin base.
export interface EventDisciplineConfigLike {
  discipline: string
  chargesEntry: boolean
  chargesAthleteFee: boolean
  athleteFee: unknown
  ageRuleMode: string
}

export interface EffectiveDisciplineConfig {
  discipline: DisciplineValue
  // Los dos son independientes: polo prende los dos y los cobros se suman.
  chargesEntry: boolean
  chargesAthleteFee: boolean
  // Monto de la cuota por deportista, como string decimal para no perder
  // precisión al cruzar el límite servidor/cliente. null si no se cobra.
  athleteFee: string | null
  ageRuleMode: AgeRuleModeValue
}

function ageRuleModeOf(value: string): AgeRuleModeValue {
  return value === "MAX_AGE_ONLY" ? "MAX_AGE_ONLY" : DEFAULT_AGE_RULE_MODE
}

/**
 * Configuración efectiva de una disciplina en un evento. Sin fila devuelve el
 * default histórico —cobra por formación—, así que es seguro llamarla para
 * cualquier evento, incluidos los anteriores a esta tabla.
 */
export function disciplineConfigFor(
  configs: readonly EventDisciplineConfigLike[],
  discipline: string
): EffectiveDisciplineConfig {
  // Disciplina desconocida (dato viejo): se trata como el default, igual que
  // hace disciplineStyle en lib/disciplines.
  const normalized: DisciplineValue = isDiscipline(discipline)
    ? discipline
    : "DIVING"
  const row = configs.find((config) => config.discipline === discipline)
  if (!row) {
    return {
      discipline: normalized,
      chargesEntry: true,
      chargesAthleteFee: false,
      athleteFee: null,
      ageRuleMode: DEFAULT_AGE_RULE_MODE,
    }
  }

  return {
    discipline: normalized,
    chargesEntry: row.chargesEntry,
    chargesAthleteFee: row.chargesAthleteFee,
    // La cuota solo tiene sentido si se cobra; si el concepto se apagó, un
    // valor residual de una configuración anterior se ignora.
    athleteFee:
      row.chargesAthleteFee && row.athleteFee != null
        ? String(row.athleteFee)
        : null,
    ageRuleMode: ageRuleModeOf(row.ageRuleMode),
  }
}

/**
 * Un concepto habilitado sin precio no puede vender. La cuota por deportista es
 * la única que se valida acá: el precio de la formación vive en la prueba.
 */
export function isPricingConfigurationValid(
  config: EffectiveDisciplineConfig
): boolean {
  if (!config.chargesAthleteFee) return true
  if (config.athleteFee === null) return false
  const fee = Number(config.athleteFee)
  return Number.isFinite(fee) && fee > 0
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run src/lib/event-pricing.test.ts`
Expected: los bloques `disciplineConfigFor`, `isPricingConfigurationValid` y `regla de edad Sub-N` en PASS. Los de `computePlanPricing` todavía fallan de compilación — se arreglan en la Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-pricing.ts src/lib/event-pricing.test.ts
git commit -m "El motor de precios habla de conceptos de cobro, no de modos"
```

---

### Task 3: El motor cobra los dos conceptos y respeta la elección del club

**Files:**
- Modify: `src/lib/event-pricing.ts:123-350`
- Test: `src/lib/event-pricing.test.ts:147-317`

**Interfaces:**
- Consumes: `EffectiveDisciplineConfig`, `disciplineConfigFor`, `isPricingConfigurationValid` (Task 2)
- Produces:
  ```ts
  export interface PricingPlanLike {
    id: string
    eventId: string | null
    // null = lo que diga el evento. Solo un false explícito quita el cobro.
    paysEntry?: boolean | null
    paysAthleteFee?: boolean | null
    registrations: Array<{
      id: string
      modality: { discipline: string; price: unknown }
      athletes: Array<{ athleteId: string; athlete: { firstNames: string; lastNames: string } }>
    }>
  }
  export interface DisciplinePricingSummary {
    discipline: DisciplineValue
    chargesEntry: boolean       // reemplaza a pricingMode
    chargesAthleteFee: boolean  // reemplaza a pricingMode
    entryCount: number
    athleteCount: number
    entriesAmount: number
    feesAmount: number
    subtotal: number
  }
  ```

- [ ] **Step 1: Escribir los tests que fallan**

En `src/lib/event-pricing.test.ts`, después del `describe("computePlanPricing · cuota fija por deportista")`, agregar:

```ts
const POLO_AMBOS: EventDisciplineConfigLike[] = [
  {
    discipline: "WATER_POLO",
    chargesEntry: true,
    chargesAthleteFee: true,
    athleteFee: "60.00",
    ageRuleMode: "MAX_AGE_ONLY",
  },
]

function planCon(
  choice: { paysEntry?: boolean | null; paysAthleteFee?: boolean | null },
  registrations: PricingPlanLike["registrations"]
): PricingPlanLike {
  return { id: "plan-1", eventId: "event-1", ...choice, registrations }
}

describe("computePlanPricing · polo cobra los dos conceptos", () => {
  const plantel = () =>
    entry("r1", "WATER_POLO", "500.00", [
      ["a1", ANA],
      ["a2", LUZ],
    ])

  it("sin elección explícita cobra el plantel y las dos cuotas", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("620")
  })

  it("el club que solo paga por deportista no paga el plantel", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysEntry: false, paysAthleteFee: true }, [plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("120")
    // La formación se conserva como registro nominal, pero a 0.
    const entryLine = pricing.lines.find((l) => l.kind === "ENTRY")!
    expect(entryLine.amount.isZero()).toBe(true)
  })

  it("el club que solo paga el plantel no paga cuotas", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysEntry: true, paysAthleteFee: false }, [plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("500")
    expect(pricing.lines.filter((l) => l.kind === "ATHLETE_FEE")).toHaveLength(0)
  })

  it("no marcar ningún concepto deja el total en cero: la validación lo bloquea", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysEntry: false, paysAthleteFee: false }, [plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("0")
  })

  it("la elección del club no puede prender un concepto que el evento no cobra", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysEntry: true, paysAthleteFee: true }, [
        entry("r1", "ARTISTIC_SWIMMING", "150.00", [["a1", ANA]]),
      ]),
      []
    )
    expect(pricing.total.toString()).toBe("150")
    expect(pricing.lines.filter((l) => l.kind === "ATHLETE_FEE")).toHaveLength(0)
  })

  it("una cuota ya pagada no se vuelve a cobrar aunque el plantel sí", async () => {
    const pricing = await computePlanPricing(
      coverage([{ discipline: "WATER_POLO", athleteId: "a1", code: "INS-XYZ" }]),
      plan([plantel()]),
      POLO_AMBOS
    )
    expect(pricing.total.toString()).toBe("560")
    expect(pricing.coveredAthleteFees).toBe(1)
  })

  it("el desglose por disciplina reporta los dos conceptos", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([plantel()]),
      POLO_AMBOS
    )
    expect(pricing.byDiscipline[0]).toMatchObject({
      discipline: "WATER_POLO",
      chargesEntry: true,
      chargesAthleteFee: true,
      entriesAmount: 500,
      feesAmount: 120,
      subtotal: 620,
    })
  })

  it("señala el concepto habilitado sin cuota en vez de cobrar cero", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      plan([plantel()]),
      [{ ...POLO_AMBOS[0], athleteFee: null }]
    )
    expect(pricing.misconfiguredDisciplines).toEqual(["WATER_POLO"])
  })

  it("no señala mala configuración si el club no eligió pagar esa cuota", async () => {
    const pricing = await computePlanPricing(
      NO_COVERAGE,
      planCon({ paysAthleteFee: false }, [plantel()]),
      [{ ...POLO_AMBOS[0], athleteFee: null }]
    )
    expect(pricing.misconfiguredDisciplines).toEqual([])
  })
})
```

Y en el `describe("computePlanPricing · cuota fija por deportista")` existente, cambiar la aserción del test "en un evento mixto…" que usa `pricingMode`:

```ts
    expect(diving).toMatchObject({
      chargesEntry: false,
      chargesAthleteFee: true,
      entriesAmount: 0,
      feesAmount: 80,
      subtotal: 80,
    })
    expect(artistic).toMatchObject({
      chargesEntry: true,
      chargesAthleteFee: false,
      entriesAmount: 150,
      feesAmount: 0,
      subtotal: 150,
    })
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run src/lib/event-pricing.test.ts`
Expected: FAIL — el total de polo da 500 (solo la formación) y `chargesEntry` no existe en el resumen.

- [ ] **Step 3: Implementar en `computePlanPricing`**

En `src/lib/event-pricing.ts`, agregar los dos campos a `PricingPlanLike`:

```ts
export interface PricingPlanLike {
  id: string
  eventId: string | null
  /** Qué conceptos eligió pagar el club. null = lo que diga el evento. */
  paysEntry?: boolean | null
  paysAthleteFee?: boolean | null
  registrations: Array<{
    id: string
    modality: { discipline: string; price: unknown }
    athletes: Array<{
      athleteId: string
      athlete: { firstNames: string; lastNames: string }
    }>
  }>
}
```

Cambiar `DisciplinePricingSummary`:

```ts
export interface DisciplinePricingSummary {
  discipline: DisciplineValue
  // Qué cobra el evento en esta disciplina. Los dos pueden ser ciertos.
  chargesEntry: boolean
  chargesAthleteFee: boolean
  entryCount: number
  /** Deportistas distintos con al menos una formación en la disciplina. */
  athleteCount: number
  entriesAmount: number
  feesAmount: number
  subtotal: number
}
```

Dentro de `computePlanPricing`, reemplazar el bucle de registraciones y el de cuotas:

```ts
  const lines: PlanPricingLine[] = []
  const misconfigured = new Set<DisciplineValue>()

  // La elección del club NUNCA prende un concepto que el evento no cobra: solo
  // puede apagar uno. Por eso es un AND, no un OR.
  const paysEntry = plan.paysEntry ?? true
  const paysAthleteFee = plan.paysAthleteFee ?? true

  // Deportistas distintos por disciplina, en orden estable de aparición.
  const athletesByDiscipline = new Map<
    DisciplineValue,
    Map<string, { firstNames: string; lastNames: string }>
  >()

  for (const registration of plan.registrations) {
    const config = disciplineConfigFor(configs, registration.modality.discipline)
    const chargeEntry = config.chargesEntry && paysEntry
    const chargeFee = config.chargesAthleteFee && paysAthleteFee
    if (chargeFee && !isPricingConfigurationValid(config)) {
      misconfigured.add(config.discipline)
    }

    lines.push({
      kind: "ENTRY",
      discipline: config.discipline,
      registrationId: registration.id,
      // La línea existe siempre —es el registro nominal— pero vale 0 cuando
      // este plan no paga por formación.
      amount: chargeEntry
        ? new Prisma.Decimal(String(registration.modality.price))
        : new Prisma.Decimal(0),
      alreadyCovered: false,
    })

    if (!chargeFee) continue
    const bucket =
      athletesByDiscipline.get(config.discipline) ??
      new Map<string, { firstNames: string; lastNames: string }>()
    for (const row of registration.athletes) {
      if (!bucket.has(row.athleteId)) bucket.set(row.athleteId, row.athlete)
    }
    athletesByDiscipline.set(config.discipline, bucket)
  }
```

El bloque de `covered` y el bucle que emite las líneas `ATHLETE_FEE` quedan igual.

En la construcción de `byDiscipline`, cambiar el objeto inicial:

```ts
    const config = disciplineConfigFor(configs, line.discipline)
    const summary =
      byDiscipline.get(line.discipline) ??
      ({
        discipline: line.discipline,
        chargesEntry: config.chargesEntry,
        chargesAthleteFee: config.chargesAthleteFee,
        entryCount: 0,
        athleteCount: 0,
        entriesAmount: 0,
        feesAmount: 0,
        subtotal: 0,
      } satisfies DisciplinePricingSummary)
```

Y en el bucle final que cuenta deportistas distintos, cambiar la condición de salto:

```ts
  // Deportistas distintos también en las disciplinas que no emiten línea de cuota.
  for (const registration of plan.registrations) {
    const config = disciplineConfigFor(configs, registration.modality.discipline)
    if (config.chargesAthleteFee && paysAthleteFee) continue
    const summary = byDiscipline.get(config.discipline)
    if (!summary) continue
    summary.athleteCount = countDistinctAthletes(plan, config.discipline, configs)
  }
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run src/lib/event-pricing.test.ts`
Expected: PASS, incluidos los tests históricos de "precio por formación" y "cuota fija".

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-pricing.ts src/lib/event-pricing.test.ts
git commit -m "El motor suma los dos conceptos y respeta lo que eligio el club"
```

---

### Task 4: Validación bloquea la planilla que no paga nada

**Files:**
- Modify: `src/lib/plan-validation.ts:18-46` (códigos), `:807-816` (mala configuración)
- Test: `src/lib/plan-validation.test.ts`

**Interfaces:**
- Consumes: `PricingPlanLike.paysEntry/paysAthleteFee`, `DisciplinePricingSummary.chargesEntry/chargesAthleteFee` (Task 3)
- Produces: código de issue `CHARGE_SELECTION_REQUIRED`

- [ ] **Step 1: Ampliar el ayudante `plan(...)` del archivo de tests**

`src/lib/plan-validation.test.ts:116-176` tiene un ayudante `plan({ roster, registrations, categories })` que arma un `RegistrationPlanForValidation` completo. Hoy no puebla `disciplineConfigs` ni los campos de elección, así que hay que ampliarlo.

En la firma:

```ts
function plan(input: {
  roster: Athlete[]
  registrations: Registration[]
  categories?: Category[]
  disciplineConfigs?: Array<{
    discipline: string
    chargesEntry: boolean
    chargesAthleteFee: boolean
    athleteFee: string | null
    ageRuleMode: string
  }>
  paysEntry?: boolean | null
  paysAthleteFee?: boolean | null
}): RegistrationPlanForValidation {
```

En el objeto devuelto, junto a `currentStep: 3`:

```ts
    paysEntry: input.paysEntry ?? null,
    paysAthleteFee: input.paysAthleteFee ?? null,
```

y dentro de `event`, junto a `season`:

```ts
      disciplineConfigs: input.disciplineConfigs ?? [],
```

- [ ] **Step 2: Dar de alta `eventAthleteFee` en el doble de transacción**

`transactionMock` (`:190-226`) no incluye `eventAthleteFee`, y en cuanto una disciplina cobre cuota por deportista `coverageLookupFor` va a consultarla. Agregar al objeto `tx`:

```ts
    eventAthleteFee: { findMany: vi.fn().mockResolvedValue([]) },
```

- [ ] **Step 3: Escribir los tests que fallan**

Al final de `src/lib/plan-validation.test.ts`:

```ts
describe("elección de conceptos de cobro", () => {
  const POLO_AMBOS = [
    {
      discipline: "WATER_POLO",
      chargesEntry: true,
      chargesAthleteFee: true,
      athleteFee: "60.00",
      ageRuleMode: "RANGE",
    },
  ]

  function planteles(
    disciplineConfigs: typeof POLO_AMBOS,
    choice: { paysEntry?: boolean | null; paysAthleteFee?: boolean | null }
  ) {
    const jugador = athlete("j1", { disciplines: ["WATER_POLO"] })
    const plantel = modality("m-polo", {
      discipline: "WATER_POLO",
      name: "Plantel",
      minAthletes: 1,
      maxAthletes: 14,
      price: new Prisma.Decimal(500),
    })
    return plan({
      roster: [jugador],
      registrations: [registration("r1", plantel, [{ athlete: jugador }])],
      disciplineConfigs,
      ...choice,
    })
  }

  it("bloquea la planilla que no eligió pagar ningún concepto", async () => {
    const target = planteles(POLO_AMBOS, {
      paysEntry: false,
      paysAthleteFee: false,
    })
    const { tx } = transactionMock(target)

    const result = await validateRegistrationPlanInTransaction(
      tx,
      { planId: "plan-1", clubId: "club-1", now },
      target
    )

    expect(result.valid).toBe(false)
    expect(
      result.issues.find((row) => row.code === "CHARGE_SELECTION_REQUIRED")
    ).toMatchObject({ severity: "ERROR", action: "EDIT_ENTRY" })
  })

  it("no exige elección cuando el evento cobra un solo concepto", async () => {
    const target = planteles(
      [{ ...POLO_AMBOS[0], chargesAthleteFee: false, athleteFee: null }],
      { paysEntry: false, paysAthleteFee: false }
    )
    const { tx } = transactionMock(target)

    const result = await validateRegistrationPlanInTransaction(
      tx,
      { planId: "plan-1", clubId: "club-1", now },
      target
    )

    expect(
      result.issues.some((row) => row.code === "CHARGE_SELECTION_REQUIRED")
    ).toBe(false)
  })

  it("una planilla sin elección explícita paga los dos conceptos", async () => {
    const target = planteles(POLO_AMBOS, {})
    const { tx } = transactionMock(target)

    const result = await validateRegistrationPlanInTransaction(
      tx,
      { planId: "plan-1", clubId: "club-1", now },
      target
    )

    expect(result.summary.totalAmount).toBe(560)
    expect(
      result.issues.some((row) => row.code === "CHARGE_SELECTION_REQUIRED")
    ).toBe(false)
  })
})
```

Confirmar la firma exacta de `transactionMock` y de `validateRegistrationPlanInTransaction` contra los tests vecinos del archivo: si `transactionMock` devuelve más cosas que `tx`, desestructurar solo lo que haga falta.

- [ ] **Step 4: Correr los tests para verificar que fallan**

Run: `npx vitest run src/lib/plan-validation.test.ts`
Expected: FAIL — no se emite ningún issue con ese código.

- [ ] **Step 5: Implementar la regla**

En `src/lib/plan-validation.ts`, agregar el código al union `PlanValidationIssueCode` (después de `"DISCIPLINE_PRICING_INVALID"`):

```ts
  | "CHARGE_SELECTION_REQUIRED"
```

Y justo antes del bloque de `pricing.misconfiguredDisciplines` (línea ~807):

```ts
  // El club puede elegir qué conceptos paga solo cuando el evento cobra los dos.
  // Apagarlos ambos dejaría la planilla en S/ 0 con deportistas inscritos.
  const ofreceEleccion = pricing.byDiscipline.some(
    (row) => row.chargesEntry && row.chargesAthleteFee
  )
  if (ofreceEleccion && plan.paysEntry === false && plan.paysAthleteFee === false) {
    issues.push(
      issue(
        "CHARGE_SELECTION_REQUIRED",
        "Elige al menos una forma de pago: la inscripción del equipo o la cuota por deportista.",
        "EDIT_ENTRY"
      )
    )
  }
```

Y cambiar el mensaje del bloque de mala configuración para que hable de conceptos:

```ts
  // Un concepto habilitado sin precio no puede vender.
  for (const discipline of pricing.misconfiguredDisciplines) {
    issues.push(
      issue(
        "DISCIPLINE_PRICING_INVALID",
        `La cuota por deportista de ${disciplineLabel(discipline)} no está configurada. Avisa a la federación.`,
        "CONTACT_FEDERATION"
      )
    )
  }
```

(el texto no cambia; se conserva tal cual porque sigue siendo exacto).

- [ ] **Step 6: Correr los tests para verificar que pasan**

Run: `npx vitest run src/lib/plan-validation.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/plan-validation.ts src/lib/plan-validation.test.ts
git commit -m "Bloquea la planilla que no eligio ninguna forma de pago"
```

---

### Task 5: La nota del ítem de orden dice por qué la formación vale 0

**Files:**
- Modify: `src/lib/registration-plans.ts:1424-1447` (`buildRegistrationDescription`), `:1759-1830` (checkout)
- Test: `src/lib/registration-plans.test.ts`

**Interfaces:**
- Consumes: `DisciplinePricingSummary.chargesEntry/chargesAthleteFee` (Task 3)
- Produces: `buildRegistrationDescription(plan, registration, note: EntryChargeNote)` donde `type EntryChargeNote = "CHARGED" | "IN_ATHLETE_FEE" | "CLUB_PAYS_PER_ATHLETE"`

- [ ] **Step 1: Escribir el test que falla**

En `src/lib/registration-plans.test.ts` agregar:

```ts
describe("nota de la formación en el comprobante", () => {
  it("explica que la formación va en la cuota cuando el evento no la cobra", () => {
    expect(entryChargeSuffix("IN_ATHLETE_FEE")).toBe(
      " | incluida en la cuota por deportista"
    )
  })

  it("explica que el club eligió pagar por deportista", () => {
    expect(entryChargeSuffix("CLUB_PAYS_PER_ATHLETE")).toBe(
      " | sin cargo: el club paga por deportista"
    )
  })

  it("no agrega nota cuando la formación sí se cobra", () => {
    expect(entryChargeSuffix("CHARGED")).toBe("")
  })
})
```

Agregar `entryChargeSuffix` al `import` desde `./registration-plans`.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/registration-plans.test.ts`
Expected: FAIL — `entryChargeSuffix` no está exportada.

- [ ] **Step 3: Implementar**

En `src/lib/registration-plans.ts`, reemplazar `buildRegistrationDescription` por:

```ts
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

function buildRegistrationDescription(
  plan: RegistrationPlanForValidation,
  registration: RegistrationPlanForValidation["registrations"][number],
  note: EntryChargeNote = "CHARGED"
): string {
  const modality = registration.modality
  const label = [
    disciplineLabel(modality.discipline),
    modality.name,
    modality.category,
  ]
    .filter(Boolean)
    .join(" — ")
  const athletes = registration.athletes
    .map(
      (row) =>
        `${row.athlete.firstNames} ${row.athlete.lastNames}${row.isReserve ? " (reserva)" : ""}`
    )
    .join(", ")
  return `${plan.event?.name ?? "Competencia"} | ${label} | ${athletes}${entryChargeSuffix(note)}`
}
```

En `checkoutRegistrationPlan`, reemplazar el cálculo de `perAthleteDisciplines` (línea ~1766) por una función que devuelve la nota:

```ts
      // Por qué la línea de una formación puede valer 0: o el evento no cobra
      // por formación en esa disciplina, o el club eligió no pagar ese concepto.
      const chargesEntryByDiscipline = new Map(
        pricing.byDiscipline.map((row) => [row.discipline as string, row.chargesEntry])
      )
      const noteFor = (discipline: string): EntryChargeNote => {
        if (chargesEntryByDiscipline.get(discipline) === false) return "IN_ATHLETE_FEE"
        if (plan.paysEntry === false) return "CLUB_PAYS_PER_ATHLETE"
        return "CHARGED"
      }
```

Y en el `map` que construye los ítems:

```ts
                  description: buildRegistrationDescription(
                    plan,
                    registration,
                    noteFor(registration.modality.discipline)
                  ),
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run src/lib/registration-plans.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/registration-plans.ts src/lib/registration-plans.test.ts
git commit -m "El comprobante explica por que una formacion vale cero"
```

---

### Task 6: Mutación y server action para guardar la elección del club

**Files:**
- Modify: `src/lib/registration-plans.ts` (nueva función, junto a `updateRegistrationPlanStep`), `src/app/(portal)/inscripciones/actions.ts`
- Test: `src/lib/registration-plans.test.ts`

**Interfaces:**
- Consumes: `editablePlan`, `lockPlan`, `planMutationTransaction`, `planRef` (privadas del módulo, ya existen)
- Produces:
  ```ts
  export async function setRegistrationPlanCharges(input: {
    planId: string
    clubId: string
    expectedRevision: number
    paysEntry: boolean
    paysAthleteFee: boolean
  }): Promise<RegistrationPlanActionResult<RegistrationPlanRef>>

  // server action
  export async function setPlanChargesAction(input: {
    planId: string
    expectedRevision: number
    paysEntry: boolean
    paysAthleteFee: boolean
  }): Promise<RegistrationPlanActionResult<RegistrationPlanRef>>
  ```

- [ ] **Step 1: Escribir el test que falla**

`src/lib/registration-plans.test.ts` mockea `./prisma` con un objeto `database` creado por `vi.hoisted`, cuyo `tx` ya trae `registrationPlan.findFirst/update` y `$queryRaw`. No hace falta tocar el doble. Agregar `setRegistrationPlanCharges` al `import` del archivo y, al final:

```ts
describe("elección de conceptos de cobro", () => {
  function editablePlan() {
    database.tx.registrationPlan.findFirst.mockResolvedValue({
      id: "plan-1",
      clubId: "club-1",
      eventId: "event-1",
      disciplineScope: "WATER_POLO",
      status: "DRAFT",
      revision: 4,
      currentStep: 2,
    })
    database.tx.registrationPlan.update.mockResolvedValue({
      id: "plan-1",
      status: "DRAFT",
      revision: 5,
      currentStep: 2,
      eventId: "event-1",
    })
  }

  it("guarda las dos banderas y sube la revisión", async () => {
    editablePlan()

    const result = await setRegistrationPlanCharges({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 4,
      paysEntry: false,
      paysAthleteFee: true,
    })

    expect(result).toMatchObject({ success: true, revision: 5 })
    expect(database.tx.registrationPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: {
        paysEntry: false,
        paysAthleteFee: true,
        revision: { increment: 1 },
      },
    })
  })

  it("rechaza una planilla que ya tiene orden", async () => {
    editablePlan()
    database.tx.registrationPlan.findFirst.mockResolvedValue({
      id: "plan-1",
      clubId: "club-1",
      eventId: "event-1",
      disciplineScope: "WATER_POLO",
      status: "AWAITING_PAYMENT",
      revision: 4,
      currentStep: 4,
    })

    const result = await setRegistrationPlanCharges({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 4,
      paysEntry: true,
      paysAthleteFee: true,
    })

    expect(result).toMatchObject({ success: false, code: "PLAN_NOT_EDITABLE" })
    expect(database.tx.registrationPlan.update).not.toHaveBeenCalled()
  })

  it("rechaza una revisión vieja en vez de pisar otro cambio", async () => {
    editablePlan()

    const result = await setRegistrationPlanCharges({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 3,
      paysEntry: true,
      paysAthleteFee: false,
    })

    expect(result).toMatchObject({
      success: false,
      code: "REVISION_CONFLICT",
      currentRevision: 4,
    })
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/registration-plans.test.ts`
Expected: FAIL — `setRegistrationPlanCharges` no existe.

- [ ] **Step 3: Implementar la mutación**

En `src/lib/registration-plans.ts`, junto a `updateRegistrationPlanStep`:

```ts
/**
 * Guarda qué conceptos eligió pagar el club. Solo tiene efecto cuando el evento
 * cobra los dos; la validación es la que bloquea apagarlos ambos, porque acá no
 * se conoce la configuración del evento sin una consulta extra.
 */
export async function setRegistrationPlanCharges(input: {
  planId: string
  clubId: string
  expectedRevision: number
  paysEntry: boolean
  paysAthleteFee: boolean
}): Promise<RegistrationPlanActionResult<RegistrationPlanRef>> {
  try {
    return await planMutationTransaction(async (tx) => {
      await lockPlan(tx, input.planId)
      const editable = await editablePlan(tx, input)
      if (!editable.ok) return editable.result

      const updated = await tx.registrationPlan.update({
        where: { id: editable.plan.id },
        data: {
          paysEntry: input.paysEntry,
          paysAthleteFee: input.paysAthleteFee,
          revision: { increment: 1 },
        },
      })
      return { success: true, ...planRef(updated) }
    })
  } catch (error) {
    console.error("setRegistrationPlanCharges error:", error)
    return {
      success: false,
      code: isRetryableRegistrationPlanTransactionError(error)
        ? "CONCURRENT_CHANGE"
        : "UNEXPECTED_ERROR",
      error: "No se pudo guardar la forma de pago. Vuelve a intentarlo.",
    }
  }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/registration-plans.test.ts`
Expected: PASS

- [ ] **Step 5: Exponer la server action**

En `src/app/(portal)/inscripciones/actions.ts`, siguiendo el patrón de las acciones vecinas, que abren todas con `const user = await requireClubUser()`:

```ts
export async function setPlanChargesAction(input: {
  planId: string
  expectedRevision: number
  paysEntry: boolean
  paysAthleteFee: boolean
}) {
  const user = await requireClubUser()
  return setRegistrationPlanCharges({
    planId: input.planId,
    clubId: user.clubId,
    expectedRevision: input.expectedRevision,
    paysEntry: input.paysEntry,
    paysAthleteFee: input.paysAthleteFee,
  })
}
```

Copiar el manejo de `revalidatePath` de `savePlanStepAction` si esa acción lo hace; si no lo hace, esta tampoco (el wizard reconcilia por revisión, no por recarga).

- [ ] **Step 6: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores en `actions.ts` ni en `registration-plans.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/registration-plans.ts src/lib/registration-plans.test.ts "src/app/(portal)/inscripciones/actions.ts"
git commit -m "Mutacion y accion para guardar los conceptos que paga el club"
```

---

### Task 7: Presets y formulario de admin

**Files:**
- Modify: `src/lib/event-presets.ts:12-118`, `src/app/admin/eventos/actions.ts:118-320`, `src/app/admin/eventos/event-form-dialog.tsx:26,81-82,302-340,568`, `src/app/admin/eventos/[id]/page.tsx:90,119,143`

**Interfaces:**
- Consumes: `EffectiveDisciplineConfig` (Task 2)
- Produces:
  ```ts
  export interface DisciplinePreset {
    defaultChargesEntry: boolean
    defaultChargesAthleteFee: boolean
    defaultAgeRuleMode: AgeRuleModeValue
    pricingHint: string
    categoryHint: string
    categoryPlaceholder: string
    modalities: ModalityPreset[]
  }
  ```
  El formulario envía `chargesEntry` y `chargesAthleteFee` como `"on"`/ausente (checkboxes).

- [ ] **Step 1: Actualizar los presets**

En `src/lib/event-presets.ts`, cambiar la interfaz y las tres entradas. `DIVING`: `defaultChargesEntry: false, defaultChargesAthleteFee: true`. `ARTISTIC_SWIMMING`: `true, false`. `WATER_POLO`: `true, true`, y su `pricingHint`:

```ts
    pricingHint:
      "Se cobra la inscripción del plantel y además una cuota por cada jugador. El club elige cuáles paga.",
```

Quitar el `import` de `PricingModeValue`.

- [ ] **Step 2: Actualizar el schema Zod y la validación del admin**

En `src/app/admin/eventos/actions.ts`:

```ts
  chargesEntry: z.boolean(),
  chargesAthleteFee: z.boolean(),
```

en lugar de `pricingMode`, y en el `safeParse`:

```ts
    chargesEntry: formData.get("chargesEntry") === "on",
    chargesAthleteFee: formData.get("chargesAthleteFee") === "on",
```

Reemplazar la validación de la cuota:

```ts
  if (!parsed.data.chargesEntry && !parsed.data.chargesAthleteFee) {
    return {
      success: false,
      error: "El evento debe cobrar al menos un concepto.",
    }
  }
  if (
    parsed.data.chargesAthleteFee &&
    (athleteFee === null || athleteFee <= 0)
  ) {
    return {
      success: false,
      error: "La cuota por deportista debe ser mayor que cero.",
    }
  }
```

El objeto `config`:

```ts
  const config = {
    chargesEntry: parsed.data.chargesEntry,
    chargesAthleteFee: parsed.data.chargesAthleteFee,
    athleteFee:
      parsed.data.chargesAthleteFee && athleteFee !== null
        ? new Prisma.Decimal(athleteFee.toFixed(2))
        : null,
    ageRuleMode: parsed.data.ageRuleMode as AgeRuleMode,
  }
```

La comparación de config bloqueada:

```ts
    if (
      (current?.chargesEntry ?? true) !== config.chargesEntry ||
      (current?.chargesAthleteFee ?? false) !== config.chargesAthleteFee ||
      (current?.ageRuleMode ?? "RANGE") !== config.ageRuleMode ||
      currentFee !== nextFee
    ) {
```

Y el precio de las pruebas del preset:

```ts
      // Si el evento no cobra por formación, las pruebas nacen en 0.
      const price = parsed.data.chargesEntry
        ? parseFee(parsed.data.presetPrice)
        : 0
```

- [ ] **Step 3: Reemplazar el desplegable por dos casillas**

En `src/app/admin/eventos/event-form-dialog.tsx`, cambiar el estado:

```tsx
  const [chargesEntry, setChargesEntry] = useState(
    event?.chargesEntry ?? preset?.defaultChargesEntry ?? true
  )
  const [chargesAthleteFee, setChargesAthleteFee] = useState(
    event?.chargesAthleteFee ?? preset?.defaultChargesAthleteFee ?? false
  )
```

y el bloque del `<Select id="ev-pricing">` por:

```tsx
            <fieldset>
              <legend className="text-sm font-bold text-fdnda-ink">Qué se cobra</legend>
              <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                {preset.pricingHint}
              </p>
              <label className="mt-2 flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="chargesEntry"
                  checked={chargesEntry}
                  onChange={(e) => setChargesEntry(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
                />
                <span>Inscripción por formación (cada plantel, dueto o equipo paga)</span>
              </label>
              <label className="mt-2 flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="chargesAthleteFee"
                  checked={chargesAthleteFee}
                  onChange={(e) => setChargesAthleteFee(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
                />
                <span>Cuota por deportista (una sola vez en todo el evento)</span>
              </label>
              {chargesEntry && chargesAthleteFee ? (
                <p className="mt-2 rounded-control bg-fdnda-sky/25 p-2 text-xs text-fdnda-navy">
                  Con los dos conceptos, cada club elige en su planilla cuáles
                  paga. Debe marcar al menos uno.
                </p>
              ) : null}
            </fieldset>
```

Cambiar la condición del campo de cuota de `pricingMode === "PER_ATHLETE"` a `chargesAthleteFee`, y la de la línea ~568 de `pricingMode === "PER_ENTRY"` a `chargesEntry`. Actualizar el tipo de la prop `event` (línea 26): quitar `pricingMode`, agregar `chargesEntry: boolean` y `chargesAthleteFee: boolean`.

- [ ] **Step 4: Actualizar la página de detalle del evento**

En `src/app/admin/eventos/[id]/page.tsx`, reemplazar los tres usos de `pricingMode` por las banderas. En la línea ~90 el texto que describe el cobro:

```tsx
            {primaryConfig.chargesEntry && primaryConfig.chargesAthleteFee
              ? "Cobra la formación y una cuota por deportista"
              : primaryConfig.chargesAthleteFee
                ? "Cuota fija por deportista"
                : "Precio por formación"}
```

En las líneas ~119 y ~143 pasar `chargesEntry: config.chargesEntry` y `chargesAthleteFee: config.chargesAthleteFee` en vez de `pricingMode`.

- [ ] **Step 5: Verificar tipos y build**

Run: `npx tsc --noEmit && npm test`
Expected: sin errores; todos los tests en PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/event-presets.ts src/app/admin/eventos
git commit -m "El admin marca que conceptos cobra el evento, no un modo"
```

---

### Task 8: El club elige en su planilla

**Files:**
- Create: `src/app/(portal)/inscripciones/[planId]/charge-selection-card.tsx`
- Modify: `src/app/(portal)/inscripciones/types.ts:30-48,75-85`, `src/app/(portal)/inscripciones/[planId]/page.tsx`, `.../registration-plan-wizard.tsx:56-161,516-560`, `.../athlete-board.tsx`, `.../team-formation-panel.tsx:146-152`

**Interfaces:**
- Consumes: `setPlanChargesAction` (Task 6), `DisciplinePricingSummary.chargesEntry/chargesAthleteFee` (Task 3)
- Produces:
  ```tsx
  export function ChargeSelectionCard(props: {
    paysEntry: boolean
    paysAthleteFee: boolean
    entryLabel: string        // "Inscripción por equipo"
    athleteFeeLabel: string   // "Cuota por deportista · S/ 60.00"
    disabled: boolean
    onChange: (next: { paysEntry: boolean; paysAthleteFee: boolean }) => void
  }): JSX.Element
  ```

- [ ] **Step 1: Actualizar las vistas**

En `src/app/(portal)/inscripciones/types.ts`, en `ModalityView` reemplazar `pricingMode` por:

```ts
  /** Qué cobra el evento en la disciplina de esta prueba. Pueden ser los dos. */
  chargesEntry: boolean
  chargesAthleteFee: boolean
```

y en `PlanView` agregar:

```ts
  /** Conceptos que el club eligió pagar. null = lo que diga el evento. */
  paysEntry: boolean | null
  paysAthleteFee: boolean | null
```

Actualizar `src/app/(portal)/inscripciones/[planId]/page.tsx` para poblarlos desde `plan.paysEntry`, `plan.paysAthleteFee` y desde `disciplineConfigFor(event.disciplineConfigs, modality.discipline)`.

- [ ] **Step 2: Escribir el componente**

Crear `src/app/(portal)/inscripciones/[planId]/charge-selection-card.tsx`:

```tsx
"use client"

import { Card } from "@/components/ui/card"

// Solo aparece cuando el evento cobra los dos conceptos. Con uno solo no hay
// nada que elegir, y nadie puede optar por no pagar.

export function ChargeSelectionCard({
  paysEntry,
  paysAthleteFee,
  entryLabel,
  athleteFeeLabel,
  disabled,
  onChange,
}: {
  paysEntry: boolean
  paysAthleteFee: boolean
  entryLabel: string
  athleteFeeLabel: string
  disabled: boolean
  onChange: (next: { paysEntry: boolean; paysAthleteFee: boolean }) => void
}) {
  const ninguno = !paysEntry && !paysAthleteFee

  return (
    <Card className="p-5">
      <h3 className="font-heading text-lg font-bold text-fdnda-navy">
        Cómo paga tu club
      </h3>
      <p className="mt-1 text-sm text-fdnda-muted">
        Esta competencia cobra dos conceptos. Marca los que va a pagar tu club:
        se suman en el total.
      </p>
      <label className="mt-3 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={paysEntry}
          disabled={disabled}
          onChange={(event) =>
            onChange({ paysEntry: event.target.checked, paysAthleteFee })
          }
          className="mt-0.5 h-5 w-5 accent-fdnda-navy"
        />
        <span className="font-semibold text-fdnda-ink">{entryLabel}</span>
      </label>
      <label className="mt-2 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={paysAthleteFee}
          disabled={disabled}
          onChange={(event) =>
            onChange({ paysEntry, paysAthleteFee: event.target.checked })
          }
          className="mt-0.5 h-5 w-5 accent-fdnda-navy"
        />
        <span className="font-semibold text-fdnda-ink">{athleteFeeLabel}</span>
      </label>
      {ninguno ? (
        <p className="mt-3 rounded-control bg-fdnda-red-soft p-3 text-xs font-semibold text-fdnda-red-deep">
          Marca al menos uno: sin ninguno la planilla no se puede pagar.
        </p>
      ) : null}
    </Card>
  )
}
```

- [ ] **Step 3: Cablearlo en el wizard**

En `registration-plan-wizard.tsx`:

```tsx
  const [charges, setCharges] = useState({
    paysEntry: initialPlan.paysEntry ?? true,
    paysAthleteFee: initialPlan.paysAthleteFee ?? true,
  })

  // El evento ofrece elección solo si alguna de sus pruebas cobra los dos.
  const ofreceEleccion = useMemo(
    () => modalities.some((row) => row.chargesEntry && row.chargesAthleteFee),
    [modalities]
  )

  function changeCharges(next: { paysEntry: boolean; paysAthleteFee: boolean }) {
    if (readOnly || blockedMessage) return
    setCharges(next)
    void enqueue((expectedRevision) =>
      setPlanChargesAction({ planId: plan.id, expectedRevision, ...next })
    )
  }
```

Corregir `athleteFeeFor`: cambiar `row.pricingMode === "PER_ATHLETE"` por `row.chargesAthleteFee && charges.paysAthleteFee`, y el filtro del desglose por `row.chargesAthleteFee && row.athleteCount > 0`. Agregar `charges` al array de dependencias del `useMemo`.

Montar la tarjeta en el paso 2, antes de `<AthleteBoard>`:

```tsx
          {ofreceEleccion ? (
            <ChargeSelectionCard
              paysEntry={charges.paysEntry}
              paysAthleteFee={charges.paysAthleteFee}
              entryLabel="Inscripción por equipo"
              athleteFeeLabel="Cuota por deportista"
              disabled={busy || readOnly}
              onChange={changeCharges}
            />
          ) : null}
```

Importar `ChargeSelectionCard` y `setPlanChargesAction`.

- [ ] **Step 4: Corregir la nota de precio del panel de formaciones**

En `team-formation-panel.tsx`, reemplazar la línea 148:

```tsx
          {modality.chargesEntry
            ? ` · ${formatMoney(modality.price)} por formación`
            : " · incluida en la cuota por deportista"}
```

- [ ] **Step 5: Verificar en el navegador**

Run: `npm run dev`, abrir una planilla de un evento de polo con los dos conceptos.
Expected: la tarjeta aparece; desmarcar los dos muestra el aviso rojo; al ir a "Revisar y pagar" la validación bloquea con el mensaje de `CHARGE_SELECTION_REQUIRED`; el total del resumen cambia al marcar y desmarcar.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(portal)/inscripciones"
git commit -m "El club elige en su planilla que conceptos paga"
```

---

### Task 9: Retirar `pricingMode` (release siguiente)

> **No ejecutar junto con las tareas anteriores.** Esta tarea va en un despliegue posterior, cuando ya no queden instancias corriendo el código que lee la columna.

**Files:**
- Modify: `prisma/schema.prisma` (`EventDisciplineConfig`)
- Create: `prisma/migrations/20260819120000_retirar_pricing_mode/migration.sql`

- [ ] **Step 1: Confirmar que nadie la lee**

Run: `rg "pricingMode" src/ scripts/ prisma/seed.ts`
Expected: sin resultados. Si aparece alguno, arreglarlo antes de seguir.

- [ ] **Step 2: Quitar la columna del modelo**

Borrar de `prisma/schema.prisma` la línea `pricingMode PricingMode @default(PER_ENTRY)` y su comentario. El enum `PricingMode` queda huérfano: borrarlo también si `rg "PricingMode" src/ prisma/` no devuelve nada.

- [ ] **Step 3: Escribir la migración**

```sql
-- Ya nadie lee el modo excluyente: los dos conceptos viven en sus banderas.
ALTER TABLE "event_discipline_configs" DROP COLUMN "pricingMode";
DROP TYPE IF EXISTS "PricingMode";
```

- [ ] **Step 4: Aplicar y verificar**

Run: `npx prisma migrate dev --name retirar_pricing_mode && npm run check`
Expected: migración aplicada, lint + tipos + tests + build en verde.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260819120000_retirar_pricing_mode
git commit -m "Retira pricingMode: los conceptos de cobro ya viven en sus banderas"
```
