# Eventos de liga — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marcar un evento como liga y que el precio de cada plantel salga de los partidos que ese equipo juega en la fase preliminar, en vez de escribirse a mano.

**Architecture:** El motor de precios **no se toca**. En un evento de liga, cada prueba guarda `pricePerMatch`, `matchesPerTeam` y `expectedTeams`, y al guardarla el servidor escribe `price = pricePerMatch × matchesPerTeam`. El sistema sigue cobrando "una formación a S/ 1 200" como siempre; los tres campos son la memoria del cálculo, y sirven para mostrarle al club el desglose y para calcular el fixture.

**Tech Stack:** Next.js (App Router, server actions), Prisma 7 + PostgreSQL (Neon), Zod, Vitest, Tailwind.

## Global Constraints

- **El motor de precios no cambia.** Si una tarea empieza a tocar `computePlanPricing`, la solución está mal encarada.
- **Nada de la Liga de Lima se escribe en el código.** Los 4 equipos de masculino sub 15 y los 4 partidos por equipo son datos que carga el admin.
- La casilla "es liga" solo aparece cuando la disciplina del evento es `WATER_POLO`.
- Los tres campos nuevos de la prueba son anulables: una prueba de polo fuera de una liga sigue con su `price` escrito a mano.
- **Alcance: solo la fase preliminar.** No modelar semifinales ni finales.
- Comentarios y mensajes de usuario en español. Los mensajes de commit del repo van sin tildes.
- Correr `npm test` tras cada tarea; `npm run check` antes del último commit.

---

## File Structure

**Se crean:**
- `src/lib/league.ts` — las dos cuentas de la liga, puras y testeables sin base
- `src/lib/league.test.ts`
- `prisma/migrations/20260813120000_eventos_de_liga/migration.sql`

**Se modifican:**
- `prisma/schema.prisma` — `Event.isLeague`; tres columnas en `EventModality`
- `src/app/admin/eventos/actions.ts` — `saveEvent` (:140) y `saveModality` (:532)
- `src/app/admin/eventos/event-form-dialog.tsx` — casilla "es liga" y campos del preset
- `src/app/admin/eventos/[id]/modalities-manager.tsx` — tres campos en el formulario de prueba (:601-609)
- `src/app/admin/eventos/[id]/page.tsx` — muestra el fixture
- `src/app/(portal)/inscripciones/types.ts` — `ModalityView` gana el desglose
- `src/app/(portal)/inscripciones/[planId]/page.tsx` — mapeo
- `src/app/(portal)/inscripciones/[planId]/team-formation-panel.tsx:146-152` — la nota de precio

---

### Task 1: Las cuentas de la liga, puras

**Files:**
- Create: `src/lib/league.ts`
- Test: `src/lib/league.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  ```ts
  export interface LeagueCategoryPlan {
    pricePerMatch: number
    matchesPerTeam: number
    expectedTeams: number
  }
  export function leagueEntryPrice(input: Pick<LeagueCategoryPlan, "pricePerMatch" | "matchesPerTeam">): number
  export function leagueTotalMatches(input: Pick<LeagueCategoryPlan, "expectedTeams" | "matchesPerTeam">): number
  export function leaguePriceBreakdown(input: Pick<LeagueCategoryPlan, "pricePerMatch" | "matchesPerTeam">): string
  ```

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/lib/league.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  leagueEntryPrice,
  leaguePriceBreakdown,
  leagueTotalMatches,
} from "./league"

describe("leagueEntryPrice", () => {
  it("cobra los partidos que juega el equipo", () => {
    expect(leagueEntryPrice({ pricePerMatch: 300, matchesPerTeam: 4 })).toBe(1200)
  })

  it("no pierde centavos con precios decimales", () => {
    expect(leagueEntryPrice({ pricePerMatch: 62.5, matchesPerTeam: 4 })).toBe(250)
  })

  it("sin partidos no cobra", () => {
    expect(leagueEntryPrice({ pricePerMatch: 300, matchesPerTeam: 0 })).toBe(0)
  })
})

describe("leagueTotalMatches", () => {
  it("cuatro equipos que juegan cuatro partidos dan ocho partidos", () => {
    expect(leagueTotalMatches({ expectedTeams: 4, matchesPerTeam: 4 })).toBe(8)
  })

  it("tres equipos que juegan cuatro partidos dan seis partidos", () => {
    expect(leagueTotalMatches({ expectedTeams: 3, matchesPerTeam: 4 })).toBe(6)
  })

  it("redondea hacia arriba un fixture impar en vez de partir un partido", () => {
    expect(leagueTotalMatches({ expectedTeams: 3, matchesPerTeam: 3 })).toBe(5)
  })

  it("un solo equipo no juega contra nadie", () => {
    expect(leagueTotalMatches({ expectedTeams: 1, matchesPerTeam: 0 })).toBe(0)
  })
})

describe("leaguePriceBreakdown", () => {
  // No se compara contra un literal con el símbolo de moneda: formatMoney usa
  // Intl con es-PE y mete un espacio duro (U+00A0) entre "S/" y el número. Un
  // literal escrito a mano falla por un carácter invisible.
  it("explica de dónde sale el precio del plantel", () => {
    const texto = leaguePriceBreakdown({ pricePerMatch: 300, matchesPerTeam: 4 })
    expect(texto.startsWith("4 partidos × ")).toBe(true)
    expect(texto).toContain(formatMoney(300))
  })

  it("usa el singular con un solo partido", () => {
    expect(
      leaguePriceBreakdown({ pricePerMatch: 300, matchesPerTeam: 1 })
    ).toMatch(/^1 partido × /)
  })
})
```

Importar `formatMoney` desde `./utils` en el archivo de tests.

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run src/lib/league.test.ts`
Expected: FAIL — no existe `src/lib/league.ts`.

- [ ] **Step 3: Escribir el módulo**

Crear `src/lib/league.ts`:

```ts
import { formatMoney } from "./utils"

// Las dos cuentas de una liga. Viven acá, puras y sin Prisma, porque las usan
// el formulario del admin (para calcular el precio antes de guardarlo), la
// ficha del evento (para mostrar el fixture) y la planilla del club (para
// explicar de dónde sale el precio del plantel).
//
// El motor de precios NO las usa: cuando la prueba se guarda ya lleva su
// `price` multiplicado, así que el cobro sigue siendo "una formación a S/ X".

export interface LeagueCategoryPlan {
  /** Lo que cuesta un partido. */
  pricePerMatch: number
  /** Cuántos partidos juega cada equipo en la fase preliminar. */
  matchesPerTeam: number
  /** Cuántos equipos espera la categoría. */
  expectedTeams: number
}

/** Lo que paga un equipo: los partidos que juega, no los de la categoría. */
export function leagueEntryPrice(
  input: Pick<LeagueCategoryPlan, "pricePerMatch" | "matchesPerTeam">
): number {
  // Se redondea a céntimos: el precio termina en una columna Decimal(10,2).
  return Math.round(input.pricePerMatch * input.matchesPerTeam * 100) / 100
}

/**
 * Partidos de la categoría. Cada partido lo juegan dos equipos, de ahí la
 * división. Se redondea hacia arriba porque un fixture impar significa que
 * alguien juega un partido de más, no medio partido.
 */
export function leagueTotalMatches(
  input: Pick<LeagueCategoryPlan, "expectedTeams" | "matchesPerTeam">
): number {
  return Math.ceil((input.expectedTeams * input.matchesPerTeam) / 2)
}

/** "4 partidos × S/ 300.00", para que el precio no caiga del cielo. */
export function leaguePriceBreakdown(
  input: Pick<LeagueCategoryPlan, "pricePerMatch" | "matchesPerTeam">
): string {
  const unidad = input.matchesPerTeam === 1 ? "partido" : "partidos"
  return `${input.matchesPerTeam} ${unidad} × ${formatMoney(input.pricePerMatch)}`
}
```

`formatMoney` ya existe en `lib/utils` y usa `Intl.NumberFormat("es-PE")` con `style: "currency"`: el desglose hereda el mismo formato de moneda que el resto de la aplicación sin decidir nada nuevo.

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run src/lib/league.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/league.ts src/lib/league.test.ts
git commit -m "Las dos cuentas de una liga: precio del plantel y fixture"
```

---

### Task 2: Esquema y migración

**Files:**
- Modify: `prisma/schema.prisma:329-355` (`Event`), `:428-462` (`EventModality`)
- Create: `prisma/migrations/20260813120000_eventos_de_liga/migration.sql`

**Interfaces:**
- Consumes: nada
- Produces: `Event.isLeague: Boolean`, `EventModality.pricePerMatch: Decimal?`, `EventModality.matchesPerTeam: Int?`, `EventModality.expectedTeams: Int?`

- [ ] **Step 1: Agregar el campo al evento**

En `model Event`, después de `status`:

```prisma
  // Una liga cobra por partido: el precio de cada plantel sale de los partidos
  // que ese equipo juega en la fase preliminar. Hoy solo aplica a polo.
  isLeague             Boolean      @default(false)
```

- [ ] **Step 2: Agregar los tres campos a la prueba**

En `model EventModality`, después de `price`:

```prisma
  // Memoria del calculo de precio en un evento de liga. `price` ya viene
  // multiplicado; estos tres campos existen para poder explicar el desglose al
  // club y calcular el fixture de la categoria. Nulos fuera de una liga.
  pricePerMatch            Decimal?   @db.Decimal(10, 2)
  matchesPerTeam           Int?
  expectedTeams            Int?
```

- [ ] **Step 3: Escribir la migración**

Crear `prisma/migrations/20260813120000_eventos_de_liga/migration.sql`:

```sql
-- Una liga cobra por partido.
ALTER TABLE "events"
  ADD COLUMN "isLeague" BOOLEAN NOT NULL DEFAULT false;

-- Memoria del calculo del precio del plantel. Nulos fuera de una liga.
ALTER TABLE "event_modalities"
  ADD COLUMN "pricePerMatch"  DECIMAL(10,2),
  ADD COLUMN "matchesPerTeam" INTEGER,
  ADD COLUMN "expectedTeams"  INTEGER;
```

- [ ] **Step 4: Aplicar y verificar**

Run: `npx prisma migrate dev --name eventos_de_liga && npx prisma validate`
Expected: aplica sin errores y el esquema valida.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260813120000_eventos_de_liga
git commit -m "Esquema: marca de liga y memoria del calculo por partido"
```

---

### Task 3: Crear una liga desde el formulario de evento

**Files:**
- Modify: `src/app/admin/eventos/actions.ts:118-138` (schema), `:140-160` (parseo), `:332-377` (pruebas del preset), `:379-390` (create)
- Modify: `src/app/admin/eventos/event-form-dialog.tsx`

**Interfaces:**
- Consumes: `leagueEntryPrice`, `leagueTotalMatches` (Task 1); `Event.isLeague`, campos de `EventModality` (Task 2)
- Produces: el formulario envía `isLeague` (checkbox), `presetMatchesPerTeam` y `presetExpectedTeams` (números); `presetPrice` pasa a interpretarse como precio por partido cuando `isLeague`

- [ ] **Step 1: Ampliar el schema Zod**

En `src/app/admin/eventos/actions.ts`, agregar al `eventSchema`:

```ts
  isLeague: z.boolean(),
  presetMatchesPerTeam: z.string().optional(),
  presetExpectedTeams: z.string().optional(),
```

y al `safeParse`:

```ts
    isLeague: formData.get("isLeague") === "on",
    presetMatchesPerTeam: String(formData.get("presetMatchesPerTeam") ?? ""),
    presetExpectedTeams: String(formData.get("presetExpectedTeams") ?? ""),
```

- [ ] **Step 2: Validar la marca de liga**

Después de la validación de la cuota, agregar:

```ts
  // La liga es un formato de polo. Marcarla en otra disciplina crearía pruebas
  // con un precio por partido que nadie va a mostrar ni cobrar.
  if (parsed.data.isLeague && discipline !== "WATER_POLO") {
    return {
      success: false,
      error: "Solo un evento de polo acuático puede ser una liga.",
    }
  }
```

Y agregar `isLeague: parsed.data.isLeague` al objeto `data` que se usa para crear y actualizar el evento.

- [ ] **Step 3: Calcular el precio de las pruebas del preset**

En el bloque que arma `modalityRows`, reemplazar el cálculo del precio:

```ts
      // En una liga el admin escribe el precio POR PARTIDO; el precio de la
      // prueba sale de multiplicarlo por los partidos que juega cada equipo.
      const unitPrice = parsed.data.chargesEntry
        ? parseFee(parsed.data.presetPrice)
        : 0
      if (unitPrice === "invalid" || unitPrice === null) {
        return { success: false, error: "Indica el precio de las pruebas." }
      }

      const matchesPerTeam = parsed.data.isLeague
        ? Number(parsed.data.presetMatchesPerTeam)
        : null
      const expectedTeams = parsed.data.isLeague
        ? Number(parsed.data.presetExpectedTeams)
        : null
      if (
        parsed.data.isLeague &&
        (!Number.isInteger(matchesPerTeam) ||
          matchesPerTeam! < 1 ||
          !Number.isInteger(expectedTeams) ||
          expectedTeams! < 1)
      ) {
        return {
          success: false,
          error:
            "Indica cuántos equipos y cuántos partidos por equipo tiene la fase preliminar.",
        }
      }

      const price = parsed.data.isLeague
        ? leagueEntryPrice({ pricePerMatch: unitPrice, matchesPerTeam: matchesPerTeam! })
        : unitPrice
```

Y en `buildModalityRows`, pasar los tres campos nuevos junto al precio. Si `buildModalityRows` no acepta campos extra, agregarlos después con un `map` sobre `modalityRows`:

```ts
      if (parsed.data.isLeague) {
        modalityRows = modalityRows.map((row) => ({
          ...row,
          pricePerMatch: new Prisma.Decimal(unitPrice.toFixed(2)),
          matchesPerTeam,
          expectedTeams,
        }))
      }
```

Importar `leagueEntryPrice` desde `@/lib/league`.

- [ ] **Step 4: Agregar la casilla y los campos al formulario**

En `event-form-dialog.tsx`, dentro del `fieldset` de configuración de la disciplina y **solo cuando `discipline === "WATER_POLO"`**:

```tsx
            {discipline === "WATER_POLO" ? (
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="isLeague"
                  checked={isLeague}
                  onChange={(e) => setIsLeague(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
                />
                <span>
                  <span className="font-medium text-fdnda-ink">Es una liga</span>
                  <span className="ml-2 text-xs text-fdnda-muted">
                    el precio de cada plantel sale de los partidos que juega
                  </span>
                </span>
              </label>
            ) : null}
```

con `const [isLeague, setIsLeague] = useState(event?.isLeague ?? false)`.

En el bloque de pruebas iniciales (solo al crear), cuando `isLeague` esté marcada, cambiar la etiqueta del precio a "Precio por partido (S/)" y agregar los dos campos:

```tsx
                {isLeague ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="ev-matches">Partidos por equipo</Label>
                      <Input
                        id="ev-matches"
                        name="presetMatchesPerTeam"
                        type="number"
                        min={1}
                        max={40}
                        required
                        defaultValue={4}
                      />
                    </div>
                    <div>
                      <Label htmlFor="ev-teams">Equipos esperados</Label>
                      <Input
                        id="ev-teams"
                        name="presetExpectedTeams"
                        type="number"
                        min={1}
                        max={40}
                        required
                        defaultValue={3}
                      />
                    </div>
                    <p className="text-xs text-fdnda-muted sm:col-span-2">
                      Cada equipo paga {matchesPerTeam} partidos. La categoría
                      tendrá {leagueTotalMatches({ expectedTeams, matchesPerTeam })}{" "}
                      partidos en total.
                    </p>
                  </div>
                ) : null}
```

con estado local `matchesPerTeam` / `expectedTeams` alimentando ese texto en vivo, e importando `leagueTotalMatches` desde `@/lib/league`.

- [ ] **Step 5: Verificar en el navegador**

Run: `npm run dev`, crear un evento de polo con "Es una liga", precio por partido 300, 4 partidos por equipo, 4 equipos, y la prueba "Plantel".
Expected: el texto en vivo dice "8 partidos en total"; las pruebas creadas quedan con `price = 1200`, `pricePerMatch = 300`, `matchesPerTeam = 4`, `expectedTeams = 4` (verificar con `npx prisma studio`).

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/eventos/actions.ts src/app/admin/eventos/event-form-dialog.tsx
git commit -m "Crear una liga: el precio del plantel sale de los partidos"
```

---

### Task 4: Editar una prueba de liga

**Files:**
- Modify: `src/app/admin/eventos/actions.ts:532-687` (`saveModality`)
- Modify: `src/app/admin/eventos/[id]/modalities-manager.tsx:51` (tipo), `:601-609` (campo de precio), `:290-380` (celdas de la tabla)
- Modify: `src/app/admin/eventos/[id]/page.tsx`

**Interfaces:**
- Consumes: `leagueEntryPrice`, `leagueTotalMatches` (Task 1)
- Produces: el formulario de prueba envía `pricePerMatch`, `matchesPerTeam`, `expectedTeams` cuando el evento es liga; `saveModality` calcula `price` y nunca lo lee del formulario en ese caso

- [ ] **Step 1: Aceptar los campos en `saveModality`**

En el schema Zod de `saveModality`, agregar:

```ts
  pricePerMatch: z.string().optional(),
  matchesPerTeam: z.string().optional(),
  expectedTeams: z.string().optional(),
```

y en el cuerpo, antes de construir los datos de la prueba:

```ts
  const event = await prisma.event.findUnique({
    where: { id: parsed.data.eventId },
    select: { isLeague: true },
  })
  if (!event) return { success: false, error: "La competencia ya no existe." }

  // En una liga el precio de la prueba NO se escribe: se calcula. Si se leyera
  // del formulario, el desglose que ve el club podria mentir.
  let price = parseFee(parsed.data.price)
  let leagueFields: {
    pricePerMatch: Prisma.Decimal | null
    matchesPerTeam: number | null
    expectedTeams: number | null
  } = { pricePerMatch: null, matchesPerTeam: null, expectedTeams: null }

  if (event.isLeague) {
    const pricePerMatch = parseFee(parsed.data.pricePerMatch)
    const matchesPerTeam = Number(parsed.data.matchesPerTeam)
    const expectedTeams = Number(parsed.data.expectedTeams)
    if (
      pricePerMatch === "invalid" ||
      pricePerMatch === null ||
      !Number.isInteger(matchesPerTeam) ||
      matchesPerTeam < 1 ||
      !Number.isInteger(expectedTeams) ||
      expectedTeams < 1
    ) {
      return {
        success: false,
        error:
          "Indica el precio por partido, los partidos por equipo y los equipos esperados.",
      }
    }
    price = leagueEntryPrice({ pricePerMatch, matchesPerTeam })
    leagueFields = {
      pricePerMatch: new Prisma.Decimal(pricePerMatch.toFixed(2)),
      matchesPerTeam,
      expectedTeams,
    }
  }
  if (price === "invalid" || price === null) {
    return { success: false, error: "Precio inválido." }
  }
```

Incluir `...leagueFields` en el objeto que se pasa a `create` y a `update`.

- [ ] **Step 2: Mostrar los campos en el formulario de prueba**

En `modalities-manager.tsx`, agregar `isLeague: boolean` a las props del componente y a la fila (`price: number` en la línea 51 pasa a acompañarse de `pricePerMatch: number | null`, `matchesPerTeam: number | null`, `expectedTeams: number | null`).

Reemplazar el campo de precio (líneas 601-609) por:

```tsx
            {isLeague ? (
              <>
                <div>
                  <Label htmlFor="mod-price-per-match">Precio por partido (S/)</Label>
                  <Input
                    id="mod-price-per-match"
                    name="pricePerMatch"
                    type="number"
                    step="0.01"
                    min={0}
                    required
                    defaultValue={current?.pricePerMatch ?? ""}
                  />
                </div>
                <div>
                  <Label htmlFor="mod-matches">Partidos por equipo</Label>
                  <Input
                    id="mod-matches"
                    name="matchesPerTeam"
                    type="number"
                    min={1}
                    max={40}
                    required
                    defaultValue={current?.matchesPerTeam ?? 4}
                  />
                </div>
                <div>
                  <Label htmlFor="mod-teams">Equipos esperados</Label>
                  <Input
                    id="mod-teams"
                    name="expectedTeams"
                    type="number"
                    min={1}
                    max={40}
                    required
                    defaultValue={current?.expectedTeams ?? 3}
                  />
                </div>
              </>
            ) : (
              <div>
                <Label htmlFor="mod-price">Precio (S/)</Label>
                <Input
                  id="mod-price"
                  name="price"
                  type="number"
                  step="0.01"
                  min={0}
                  required
                  defaultValue={current?.price ?? ""}
                />
              </div>
            )}
```

- [ ] **Step 3: Mostrar el fixture en la tabla de pruebas**

En la celda de precio de la tabla (línea ~369), cuando la prueba tenga `matchesPerTeam`:

```tsx
                <TD className="text-right font-semibold">
                  {formatMoney(m.price)}
                  {m.matchesPerTeam !== null && m.pricePerMatch !== null ? (
                    <span className="block text-xs font-normal text-fdnda-muted">
                      {leaguePriceBreakdown({
                        pricePerMatch: m.pricePerMatch,
                        matchesPerTeam: m.matchesPerTeam,
                      })}
                      {m.expectedTeams !== null
                        ? ` · ${leagueTotalMatches({ expectedTeams: m.expectedTeams, matchesPerTeam: m.matchesPerTeam })} partidos en la categoría`
                        : ""}
                    </span>
                  ) : null}
                </TD>
```

Importar `leaguePriceBreakdown` y `leagueTotalMatches` desde `@/lib/league`.

- [ ] **Step 4: Pasar `isLeague` desde la página**

En `src/app/admin/eventos/[id]/page.tsx`, incluir `isLeague` en el `select` del evento y pasarlo al `ModalitiesManager`, junto con los tres campos nuevos en el mapeo de cada prueba.

- [ ] **Step 5: Verificar en el navegador**

Run: `npm run dev`, editar una prueba de la liga creada en la Task 3.
Expected: el formulario pide precio por partido / partidos / equipos, no precio; guardar con 300 y 4 deja `price = 1200`; la tabla muestra "S/ 1,200.00" con "4 partidos × S/ 300.00 · 8 partidos en la categoría".

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/eventos
git commit -m "Editar una prueba de liga: precio por partido y fixture"
```

---

### Task 5: El club ve de dónde sale el precio

**Files:**
- Modify: `src/app/(portal)/inscripciones/types.ts:30-48`, `src/app/(portal)/inscripciones/[planId]/page.tsx`, `src/app/(portal)/inscripciones/[planId]/team-formation-panel.tsx:146-152`

**Interfaces:**
- Consumes: `leaguePriceBreakdown` (Task 1); columnas de `EventModality` (Task 2)
- Produces: `ModalityView` gana `pricePerMatch: number | null` y `matchesPerTeam: number | null`

- [ ] **Step 1: Ampliar la vista de prueba**

En `types.ts`, dentro de `ModalityView`:

```ts
  /** En una liga: de dónde sale el precio de la formación. Nulos fuera de una liga. */
  pricePerMatch: number | null
  matchesPerTeam: number | null
```

Poblarlos en `page.tsx` con `Number(modality.pricePerMatch)` (o `null`) y `modality.matchesPerTeam`.

- [ ] **Step 2: Mostrar el desglose en el panel de formaciones**

En `team-formation-panel.tsx`, reemplazar el párrafo de la nota de precio:

```tsx
        <p className="mt-2 text-xs text-fdnda-muted">
          {ruleLabel(modality)}
          {modality.chargesEntry
            ? ` · ${formatMoney(modality.price)} por formación`
            : " · incluida en la cuota por deportista"}
          {modality.upgradeYear ? ` · admite nacidos en ${modality.upgradeYear}` : ""}
        </p>
        {modality.chargesEntry &&
        modality.pricePerMatch !== null &&
        modality.matchesPerTeam !== null ? (
          <p className="mt-1 text-xs font-semibold text-fdnda-navy">
            {leaguePriceBreakdown({
              pricePerMatch: modality.pricePerMatch,
              matchesPerTeam: modality.matchesPerTeam,
            })}
          </p>
        ) : null}
```

(La primera condición usa `chargesEntry`, que llega del plan de los dos conceptos de cobro. Si ese plan todavía no se ejecutó, la condición es `modality.pricingMode === "PER_ENTRY"`.)

Importar `leaguePriceBreakdown`.

- [ ] **Step 3: Verificar en el navegador**

Run: `npm run dev`, abrir una planilla del evento de liga.
Expected: bajo la prueba "Plantel" aparece "4 partidos × S/ 300.00", y el total de la revisión coincide con S/ 1 200 por plantel.

- [ ] **Step 4: Correr todo**

Run: `npm run check`
Expected: lint, tipos, `prisma validate`, tests y build en verde.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(portal)/inscripciones"
git commit -m "El club ve que su plantel cuesta cuatro partidos"
```
