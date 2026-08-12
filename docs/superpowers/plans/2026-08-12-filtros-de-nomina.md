# Filtros de la nómina — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el delegado vea de un vistazo a quién ya le asignó pruebas, a quién no, quién está en un plantel, y a quién del club todavía no agregó a la planilla.

**Architecture:** Los chips de estado son de cliente: la nómina completa ya viaja a la página en `PlanView.roster`, así que filtrarla es un `filter` en memoria y responde instantáneo. El único filtro que toca el servidor es "los que faltan agregar", porque la lista de deportistas del club está paginada de a 30 en `searchClubAthletesForPlan` y filtrar en memoria solo miraría la página visible.

**Tech Stack:** Next.js (App Router, server components + client components), Prisma 7, Vitest, Tailwind.

## Global Constraints

- Los filtros van en la pantalla del delegado (`/inscripciones/[planId]`, paso 2), no en el reporte del admin.
- **Filtrar nunca modifica la planilla.** Un deportista oculto por un filtro conserva sus pruebas.
- El filtro de cliente **no** se persiste en la planilla ni en la URL; el de servidor sí viaja como parámetro de búsqueda, para que recargar conserve la vista.
- La nómina puede llegar a 2 000 deportistas: los conteos de los chips se calculan una sola vez con `useMemo`, no dentro del render de cada fila.
- Comentarios y textos de usuario en español. Los mensajes de commit del repo van sin tildes.
- Correr `npm test` tras cada tarea.

---

## File Structure

**Se crean:**
- `src/lib/roster-filters.ts` — la clasificación de cada deportista, pura y testeable
- `src/lib/roster-filters.test.ts`
- `src/app/(portal)/inscripciones/[planId]/roster-filter-bar.tsx` — los chips y el selector de prueba

**Se modifican:**
- `src/lib/registration-plans.ts:1340-1405` — `searchClubAthletesForPlan` acepta `onlyUnselected`
- `src/lib/registration-plans.test.ts` — el test del filtro nuevo
- `src/app/(portal)/inscripciones/[planId]/page.tsx:62-90` — lee el parámetro de búsqueda
- `src/app/(portal)/inscripciones/[planId]/athlete-board.tsx` — monta la barra y filtra la nómina
- `src/app/(portal)/inscripciones/[planId]/registration-plan-wizard.tsx:411-417` — `pageHref` conserva el filtro

---

### Task 1: La clasificación de un deportista, pura

**Files:**
- Create: `src/lib/roster-filters.ts`
- Test: `src/lib/roster-filters.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  ```ts
  export type RosterFilter = "ALL" | "WITH_ENTRIES" | "WITHOUT_ENTRIES" | "IN_TEAM"

  export interface RosterEntryIndex {
    /** athleteId → cuántas pruebas individuales tiene marcadas. */
    individual: Map<string, number>
    /** athleteId → en cuántas formaciones de equipo participa. */
    team: Map<string, number>
  }

  export function buildRosterEntryIndex(
    entries: Array<{ modalityId: string; athleteIds: string[] }>,
    modalities: Array<{ id: string; maxAthletes: number }>
  ): RosterEntryIndex

  export function matchesRosterFilter(
    athleteId: string,
    filter: RosterFilter,
    index: RosterEntryIndex
  ): boolean

  export function rosterFilterCounts(
    athleteIds: readonly string[],
    index: RosterEntryIndex
  ): Record<RosterFilter, number>
  ```

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/lib/roster-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildRosterEntryIndex,
  matchesRosterFilter,
  rosterFilterCounts,
} from "./roster-filters"

const modalities = [
  { id: "solo", maxAthletes: 1 },
  { id: "plantel", maxAthletes: 14 },
]

// a1 tiene una prueba individual; a2 está en el plantel; a3 no tiene nada.
const entries = [
  { modalityId: "solo", athleteIds: ["a1"] },
  { modalityId: "plantel", athleteIds: ["a2", "a4"] },
]

const index = buildRosterEntryIndex(entries, modalities)

describe("buildRosterEntryIndex", () => {
  it("separa pruebas individuales de formaciones de equipo", () => {
    expect(index.individual.get("a1")).toBe(1)
    expect(index.team.get("a1")).toBeUndefined()
    expect(index.team.get("a2")).toBe(1)
    expect(index.individual.get("a2")).toBeUndefined()
  })

  it("ignora una formación de una prueba que ya no existe", () => {
    const huerfana = buildRosterEntryIndex(
      [{ modalityId: "borrada", athleteIds: ["a9"] }],
      modalities
    )
    expect(huerfana.individual.size).toBe(0)
    expect(huerfana.team.size).toBe(0)
  })
})

describe("matchesRosterFilter", () => {
  it("ALL deja pasar a cualquiera", () => {
    expect(matchesRosterFilter("a3", "ALL", index)).toBe(true)
  })

  it("WITH_ENTRIES incluye tanto la prueba individual como el plantel", () => {
    expect(matchesRosterFilter("a1", "WITH_ENTRIES", index)).toBe(true)
    expect(matchesRosterFilter("a2", "WITH_ENTRIES", index)).toBe(true)
    expect(matchesRosterFilter("a3", "WITH_ENTRIES", index)).toBe(false)
  })

  it("WITHOUT_ENTRIES es exactamente el complemento", () => {
    expect(matchesRosterFilter("a3", "WITHOUT_ENTRIES", index)).toBe(true)
    expect(matchesRosterFilter("a1", "WITHOUT_ENTRIES", index)).toBe(false)
  })

  it("IN_TEAM deja fuera a quien solo tiene pruebas individuales", () => {
    expect(matchesRosterFilter("a2", "IN_TEAM", index)).toBe(true)
    expect(matchesRosterFilter("a1", "IN_TEAM", index)).toBe(false)
  })
})

describe("rosterFilterCounts", () => {
  it("cuenta cada estado sobre la nómina que se le pasa", () => {
    expect(rosterFilterCounts(["a1", "a2", "a3"], index)).toEqual({
      ALL: 3,
      WITH_ENTRIES: 2,
      WITHOUT_ENTRIES: 1,
      IN_TEAM: 1,
    })
  })

  it("no cuenta a alguien que está en una formación pero no en la nómina", () => {
    // a4 está en el plantel pero no se le pasa: los conteos son de la nómina.
    expect(rosterFilterCounts(["a1"], index).ALL).toBe(1)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run src/lib/roster-filters.test.ts`
Expected: FAIL — no existe `src/lib/roster-filters.ts`.

- [ ] **Step 3: Escribir el módulo**

Crear `src/lib/roster-filters.ts`:

```ts
// Clasificación de la nómina para los chips del paso 2. Vive acá y no en el
// componente porque es la única parte con reglas de verdad —qué cuenta como
// "tiene pruebas"— y así se puede probar sin montar React.

export type RosterFilter = "ALL" | "WITH_ENTRIES" | "WITHOUT_ENTRIES" | "IN_TEAM"

export const ROSTER_FILTERS: readonly RosterFilter[] = [
  "ALL",
  "WITH_ENTRIES",
  "WITHOUT_ENTRIES",
  "IN_TEAM",
]

export const ROSTER_FILTER_LABELS: Record<RosterFilter, string> = {
  ALL: "Todos",
  WITH_ENTRIES: "Con pruebas",
  WITHOUT_ENTRIES: "Sin pruebas",
  IN_TEAM: "En un plantel",
}

export interface RosterEntryIndex {
  /** athleteId → cuántas pruebas individuales tiene marcadas. */
  individual: Map<string, number>
  /** athleteId → en cuántas formaciones de equipo participa. */
  team: Map<string, number>
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/**
 * Recorre las formaciones una sola vez. Una formación de una prueba que ya no
 * existe se ignora: la vista optimista puede tener un resto de una prueba que
 * el admin desactivó entre dos cargas.
 */
export function buildRosterEntryIndex(
  entries: Array<{ modalityId: string; athleteIds: string[] }>,
  modalities: Array<{ id: string; maxAthletes: number }>
): RosterEntryIndex {
  const sizeById = new Map(modalities.map((row) => [row.id, row.maxAthletes]))
  const index: RosterEntryIndex = { individual: new Map(), team: new Map() }

  for (const entry of entries) {
    const maxAthletes = sizeById.get(entry.modalityId)
    if (maxAthletes === undefined) continue
    const bucket = maxAthletes === 1 ? index.individual : index.team
    for (const athleteId of entry.athleteIds) bump(bucket, athleteId)
  }
  return index
}

export function matchesRosterFilter(
  athleteId: string,
  filter: RosterFilter,
  index: RosterEntryIndex
): boolean {
  const tieneAlgo =
    index.individual.has(athleteId) || index.team.has(athleteId)
  if (filter === "ALL") return true
  if (filter === "WITH_ENTRIES") return tieneAlgo
  if (filter === "WITHOUT_ENTRIES") return !tieneAlgo
  return index.team.has(athleteId)
}

export function rosterFilterCounts(
  athleteIds: readonly string[],
  index: RosterEntryIndex
): Record<RosterFilter, number> {
  const counts: Record<RosterFilter, number> = {
    ALL: 0,
    WITH_ENTRIES: 0,
    WITHOUT_ENTRIES: 0,
    IN_TEAM: 0,
  }
  for (const athleteId of athleteIds) {
    for (const filter of ROSTER_FILTERS) {
      if (matchesRosterFilter(athleteId, filter, index)) counts[filter] += 1
    }
  }
  return counts
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run src/lib/roster-filters.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/roster-filters.ts src/lib/roster-filters.test.ts
git commit -m "Clasificacion de la nomina para los filtros del paso 2"
```

---

### Task 2: El servidor sabe listar solo los que faltan agregar

**Files:**
- Modify: `src/lib/registration-plans.ts:1340-1405` (`searchClubAthletesForPlan`)
- Test: `src/lib/registration-plans.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `searchClubAthletesForPlan` acepta `onlyUnselected?: boolean`; con `true` excluye a los que ya están en la nómina del plan

- [ ] **Step 1: Escribir el test que falla**

`searchClubAthletesForPlan` no corre dentro de una transacción: llama a `prisma.athlete.count`, `prisma.athlete.findMany` y `prisma.registrationPlanAthlete.findMany` directamente. El doble de `src/lib/registration-plans.test.ts` solo tiene `$transaction` en `database.prisma`, así que hay que ampliarlo. En el `vi.hoisted`, dentro de `prisma`:

```ts
  prisma: {
    $transaction: vi.fn(),
    athlete: { count: vi.fn(), findMany: vi.fn() },
    registrationPlanAthlete: { findMany: vi.fn() },
  },
```

y en el `beforeEach`:

```ts
  database.prisma.athlete.count.mockResolvedValue(0)
  database.prisma.athlete.findMany.mockResolvedValue([])
  database.prisma.registrationPlanAthlete.findMany.mockResolvedValue([])
```

La relación inversa de `Athlete` hacia `RegistrationPlanAthlete` se llama `registrationPlanAthletes` (`prisma/schema.prisma:194`); ése es el nombre que va en el `where`.

Agregar `searchClubAthletesForPlan` al `import` del archivo y escribir:

```ts
describe("searchClubAthletesForPlan · solo los que faltan agregar", () => {
  it("excluye en la consulta a los que ya están en la nómina", async () => {
    await searchClubAthletesForPlan({
      clubId: "club-1",
      planId: "plan-1",
      onlyUnselected: true,
    })

    const { where } = database.prisma.athlete.findMany.mock.calls[0][0]
    expect(where).toMatchObject({
      clubId: "club-1",
      isActive: true,
      registrationPlanAthletes: { none: { planId: "plan-1" } },
    })
    // El total tiene que contar lo mismo que la página, o el paginador miente.
    expect(database.prisma.athlete.count.mock.calls[0][0].where).toMatchObject({
      registrationPlanAthletes: { none: { planId: "plan-1" } },
    })
  })

  it("sin la bandera no agrega ninguna exclusión", async () => {
    await searchClubAthletesForPlan({ clubId: "club-1", planId: "plan-1" })

    const { where } = database.prisma.athlete.findMany.mock.calls[0][0]
    expect(where.registrationPlanAthletes).toBeUndefined()
  })

  it("sin planId la bandera no hace nada: no hay nómina contra la cual excluir", async () => {
    await searchClubAthletesForPlan({ clubId: "club-1", onlyUnselected: true })

    const { where } = database.prisma.athlete.findMany.mock.calls[0][0]
    expect(where.registrationPlanAthletes).toBeUndefined()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/registration-plans.test.ts`
Expected: FAIL — el `where` no lleva la exclusión.

- [ ] **Step 3: Implementar el filtro**

En `searchClubAthletesForPlan`, agregar el parámetro y el fragmento de `where`:

```ts
export async function searchClubAthletesForPlan(input: {
  clubId: string
  planId?: string
  query?: string
  page?: number
  pageSize?: number
  disciplineAccess?: Discipline[]
  /** Solo los que todavía no están en la nómina de la planilla. */
  onlyUnselected?: boolean
}) {
```

y, junto a `search`:

```ts
  // Va en la consulta y no en un filter en memoria: la lista está paginada de a
  // 30, así que filtrar después solo miraría la página visible y el conteo
  // total mentiría.
  const pendientes =
    input.onlyUnselected && input.planId
      ? { registrationPlanAthletes: { none: { planId: input.planId } } }
      : {}
```

Incluir `...pendientes` en el `where` del `count` y en el del `findMany`, junto a `...search`.

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/registration-plans.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/registration-plans.ts src/lib/registration-plans.test.ts
git commit -m "El buscador puede listar solo a los que faltan agregar"
```

---

### Task 3: La barra de filtros

**Files:**
- Create: `src/app/(portal)/inscripciones/[planId]/roster-filter-bar.tsx`
- Modify: `src/app/(portal)/inscripciones/[planId]/athlete-board.tsx:82-114,210-251`

**Interfaces:**
- Consumes: `RosterFilter`, `ROSTER_FILTERS`, `ROSTER_FILTER_LABELS`, `rosterFilterCounts` (Task 1)
- Produces:
  ```tsx
  export function RosterFilterBar(props: {
    filter: RosterFilter
    counts: Record<RosterFilter, number>
    modalityId: string          // "" = todas las pruebas
    modalities: Array<{ id: string; label: string }>
    onFilterChange: (filter: RosterFilter) => void
    onModalityChange: (modalityId: string) => void
  }): JSX.Element
  ```

- [ ] **Step 1: Escribir el componente**

Crear `src/app/(portal)/inscripciones/[planId]/roster-filter-bar.tsx`:

```tsx
"use client"

import {
  ROSTER_FILTERS,
  ROSTER_FILTER_LABELS,
  type RosterFilter,
} from "@/lib/roster-filters"

// Filtrar NO modifica la planilla: un deportista oculto conserva sus pruebas.
// Por eso los chips no se persisten y recargar vuelve a "Todos".

export function RosterFilterBar({
  filter,
  counts,
  modalityId,
  modalities,
  onFilterChange,
  onModalityChange,
}: {
  filter: RosterFilter
  counts: Record<RosterFilter, number>
  modalityId: string
  modalities: Array<{ id: string; label: string }>
  onFilterChange: (filter: RosterFilter) => void
  onModalityChange: (modalityId: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-fdnda-border bg-fdnda-surface px-5 py-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar la nómina">
        {ROSTER_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => onFilterChange(option)}
            className={`min-h-9 rounded-control px-3 text-xs font-bold ring-1 ring-inset transition-colors ${
              filter === option
                ? "bg-fdnda-navy text-white ring-fdnda-navy"
                : "bg-white text-fdnda-muted ring-fdnda-border hover:text-fdnda-navy"
            }`}
          >
            {ROSTER_FILTER_LABELS[option]}{" "}
            <span className="num">{counts[option]}</span>
          </button>
        ))}
      </div>
      {modalities.length > 0 ? (
        <label className="ml-auto flex items-center gap-2 text-xs text-fdnda-muted">
          <span>Prueba</span>
          <select
            value={modalityId}
            onChange={(event) => onModalityChange(event.target.value)}
            className="min-h-9 rounded-control border border-fdnda-border bg-white px-2 text-xs font-semibold text-fdnda-ink focus:border-fdnda-turquoise focus:outline-none focus:ring-2 focus:ring-fdnda-turquoise/25"
          >
            <option value="">Todas</option>
            {modalities.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Filtrar la nómina en `athlete-board.tsx`**

Agregar las props `rosterFilter`, `rosterModalityId`, `onRosterFilterChange`, `onRosterModalityChange` al componente, y después del cálculo de `teamsByAthlete`:

```tsx
  const entryIndex = useMemo(
    () => buildRosterEntryIndex(entries, modalities),
    [entries, modalities]
  )
  const counts = useMemo(
    () => rosterFilterCounts(roster.map((athlete) => athlete.id), entryIndex),
    [roster, entryIndex]
  )
  // El selector de prueba se cruza con el chip: "sin pruebas" + una prueba
  // concreta no puede devolver a nadie, y eso es correcto.
  const athletesInModality = useMemo(() => {
    if (!rosterModalityId) return null
    return new Set(
      entries
        .filter((entry) => entry.modalityId === rosterModalityId)
        .flatMap((entry) => entry.athleteIds)
    )
  }, [entries, rosterModalityId])

  const visibleRoster = roster.filter(
    (athlete) =>
      matchesRosterFilter(athlete.id, rosterFilter, entryIndex) &&
      (athletesInModality === null || athletesInModality.has(athlete.id))
  )
```

Montar la barra dentro de la `Card` de la nómina, justo debajo de la barra de conteo, y cambiar el `roster.map(...)` de la lista por `visibleRoster.map(...)`. Cambiar el mensaje del estado vacío para distinguir los dos casos:

```tsx
        {roster.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Users className="h-8 w-8 text-fdnda-muted" aria-hidden="true" />
            <p className="text-sm text-fdnda-muted">
              Busca a tus deportistas arriba y agrégalos para asignarles pruebas.
            </p>
          </div>
        ) : visibleRoster.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-fdnda-muted">
            Ningún deportista de la nómina coincide con este filtro.
          </p>
        ) : (
```

Importar `useMemo` de React y los ayudantes de `@/lib/roster-filters`.

- [ ] **Step 3: Sostener el estado en el wizard**

En `registration-plan-wizard.tsx`:

```tsx
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>("ALL")
  const [rosterModalityId, setRosterModalityId] = useState("")
```

y pasarlos a `<AthleteBoard>` junto con `onRosterFilterChange={setRosterFilter}` y `onRosterModalityChange={setRosterModalityId}`.

- [ ] **Step 4: Verificar en el navegador**

Run: `npm run dev`, abrir una planilla con al menos tres deportistas: uno con prueba individual, uno en un plantel y uno sin nada.
Expected: los conteos de los chips son 3 / 2 / 1 / 1; "Sin pruebas" deja solo al tercero; elegir una prueba en el selector deja solo a quienes están en ella; ningún filtro cambia la revisión de la planilla (el indicador de guardado no se mueve).

- [ ] **Step 5: Commit**

```bash
git add src/app/"(portal)"/inscripciones/"[planId]"/roster-filter-bar.tsx src/app/"(portal)"/inscripciones/"[planId]"/athlete-board.tsx src/app/"(portal)"/inscripciones/"[planId]"/registration-plan-wizard.tsx
git commit -m "Chips de estado y filtro por prueba sobre la nomina"
```

---

### Task 4: "Solo los que faltan agregar" en el buscador

**Files:**
- Modify: `src/app/(portal)/inscripciones/[planId]/page.tsx:62-90`, `.../athlete-board.tsx:126-185`, `.../registration-plan-wizard.tsx:411-417,534-540`

**Interfaces:**
- Consumes: `searchClubAthletesForPlan({ onlyUnselected })` (Task 2)
- Produces: el parámetro de búsqueda `?faltan=1` en la URL de la planilla

- [ ] **Step 1: Leer el parámetro en la página**

En `page.tsx`, ampliar el tipo de `searchParams` y pasarlo:

```ts
  searchParams: Promise<{ q?: string; page?: string; faltan?: string }>
```

```ts
  const onlyUnselected = filters.faltan === "1"
```

```ts
    searchClubAthletesForPlan({
      clubId: user.clubId,
      planId,
      query: filters.q,
      page: pageNumber,
      pageSize: 30,
      disciplineAccess: access,
      onlyUnselected,
    }),
```

y pasar `initialOnlyUnselected={onlyUnselected}` al `RegistrationPlanWizard`.

- [ ] **Step 2: Poner el interruptor junto al buscador**

En `athlete-board.tsx`, dentro del `<form>` de búsqueda, agregar una casilla:

```tsx
        <label className="flex items-center gap-2 text-xs font-semibold text-fdnda-muted">
          <input
            type="checkbox"
            checked={onlyUnselected}
            onChange={(event) => onOnlyUnselectedChange(event.target.checked)}
            className="h-4 w-4 accent-fdnda-navy"
          />
          Solo los que faltan agregar
        </label>
```

con las props `onlyUnselected: boolean` y `onOnlyUnselectedChange: (value: boolean) => void`.

- [ ] **Step 3: Navegar conservando los tres parámetros**

En `registration-plan-wizard.tsx`, agregar `const [onlyUnselected, setOnlyUnselected] = useState(initialOnlyUnselected)` y centralizar la construcción de la URL:

```tsx
  function planHref(options: { page?: number; query?: string; faltan?: boolean }) {
    const params = new URLSearchParams()
    const q = (options.query ?? initialQuery).trim()
    if (q) params.set("q", q)
    if ((options.page ?? 1) > 1) params.set("page", String(options.page))
    if (options.faltan ?? onlyUnselected) params.set("faltan", "1")
    const suffix = params.toString()
    return `/inscripciones/${plan.id}${suffix ? `?${suffix}` : ""}`
  }
```

Reemplazar `pageHref` por `(page: number) => planHref({ page })`, hacer que el submit del buscador navegue a `planHref({ query })`, y que la casilla dispare:

```tsx
            onOnlyUnselectedChange={(value) => {
              setOnlyUnselected(value)
              void awaitSaved().then(() => {
                startTransition(() =>
                  router.push(planHref({ query, faltan: value }))
                )
              })
            }}
```

- [ ] **Step 4: Verificar en el navegador**

Run: `npm run dev`, en una planilla con varios deportistas del club ya agregados.
Expected: al marcar la casilla, el bloque "Agregar a la planilla" solo lista a los que faltan y el contador de resultados baja; recargar la página conserva la casilla marcada; paginar y buscar la conservan también.

- [ ] **Step 5: Correr todo**

Run: `npm run check`
Expected: lint, tipos, `prisma validate`, tests y build en verde.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(portal)/inscripciones"
git commit -m "Buscador: ver solo a los deportistas que faltan agregar"
```
