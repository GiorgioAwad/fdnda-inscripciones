# Campeonato de niveles de natación artística — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un evento de natación artística pueda marcarse como «campeonato de niveles» y nazca con las categorías de básico, intermedio y avanzado que mandan las bases de la FDNDA.

**Architecture:** Una bandera en `Event` (gemela de `isLeague`) y una columna `level` en `EventModality`. Las tablas de categorías de las bases viven en un módulo puro nuevo, `src/lib/artistic-levels.ts`, que calcula los años de nacimiento desde el año de la temporada. El formulario manda las categorías por nivel en un campo oculto JSON propio, sin tocar el camino plano que usan clavados, polo y artística sin niveles.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Prisma 7 + PostgreSQL, Zod 4, Vitest 4, Tailwind 4.

## Global Constraints

- **Idioma:** todo el código, los comentarios y los mensajes de error van en español, como el resto del repo. Los identificadores de código en inglés solo cuando el modelo ya los usa así (`birthYearFrom`, `sexRule`).
- **Los defaults son el comportamiento histórico.** Ningún evento existente puede cambiar de precio, de elegibilidad ni de etiqueta. `isLevelChampionship` nace `false` y `level` nace `NULL`.
- **`birthYearFrom` es el año más viejo admitido y `birthYearTo` el más joven.** `null` de cualquier lado = sin tope por ahí. Verificado en `src/lib/categories.ts:17-21`.
- **La edad se mide al 31 de diciembre:** `birthYearFrom = seasonYear - edadMáxima`, `birthYearTo = seasonYear - edadMínima`. **No uses `birthYearForMaxAge`**, que hace `-edad + 1` porque el «Sub-N» de polo mide con otro corte.
- **`src/app/admin/eventos/actions.ts` lleva `"use server"`:** solo puede exportar funciones `async`. Cualquier cosa que quieras testear unitariamente tiene que vivir en `src/lib/`.
- **Rango de años válido:** 1950–2050, igual que `parseYear` en `src/lib/event-categories.ts:28-34`.
- **Tope del generador:** `MAX_BULK_MODALITIES = 300`, aplicado sobre la suma de los tres niveles.
- **Comandos:** `npm test` (unitario, sin base de datos), `npx tsc --noEmit`, `npm run lint`, `npx prisma validate`.

---

### Task 1: El módulo de niveles y las tablas de las bases

Módulo puro, sin Prisma ni React. Es el gemelo de `src/lib/league.ts` y carga con casi toda la verificación del plan.

**Files:**
- Create: `src/lib/artistic-levels.ts`
- Test: `src/lib/artistic-levels.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `ARTISTIC_LEVEL_VALUES: readonly ["BASICO", "INTERMEDIO", "AVANZADO"]`
  - `type ArtisticLevelValue = "BASICO" | "INTERMEDIO" | "AVANZADO"`
  - `ARTISTIC_LEVEL_LABELS: Record<ArtisticLevelValue, string>`
  - `interface LevelCategoryDraft { level: ArtisticLevelValue; label: string; from: number | null; to: number | null; maleFrom: number | null }`
  - `levelCategoryPreset(seasonYear: number): LevelCategoryDraft[]`
  - `parseLevelCategories(value: string): LevelCategoryDraft[] | null`
  - `isArtisticLevel(value: unknown): value is ArtisticLevelValue`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/artistic-levels.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  ARTISTIC_LEVEL_VALUES,
  levelCategoryPreset,
  parseLevelCategories,
  type LevelCategoryDraft,
} from "./artistic-levels"

function categoriesOf(
  preset: LevelCategoryDraft[],
  level: string
): Array<[string, number | null, number | null, number | null]> {
  return preset
    .filter((row) => row.level === level)
    .map((row) => [row.label, row.from, row.to, row.maleFrom])
}

// Este es EL test del plan. Los años de abajo están copiados de la sección VI
// de las «Bases Generales II Campeonato de Niveles» (edades al 31/12/2026).
// Si alguien mete un ±1 en la aritmética, se rompe acá y no en una inscripción
// real donde una nadadora aparece en la categoría equivocada.
describe("las categorías de las bases con temporada 2026", () => {
  const preset = levelCategoryPreset(2026)

  it("básico e intermedio comparten la tabla impresa en las bases", () => {
    const esperado = [
      ["Infantil D", 2018, null, null],
      ["Infantil A", 2016, 2017, null],
      ["Infantil B", 2014, 2015, null],
      ["Juvenil", 2011, 2013, 2010],
      ["Junior/Senior", null, 2011, null],
    ]
    expect(categoriesOf(preset, "BASICO")).toEqual(esperado)
    expect(categoriesOf(preset, "INTERMEDIO")).toEqual(esperado)
  })

  it("avanzado tiene su propia tabla", () => {
    expect(categoriesOf(preset, "AVANZADO")).toEqual([
      ["12 y menos", 2014, null, null],
      ["Juvenil", 2011, 2013, 2010],
      ["Junior", 2007, 2011, 2006],
      ["Senior", null, 2011, null],
    ])
  })

  it("cubre los tres niveles y ninguno más", () => {
    expect([...new Set(preset.map((row) => row.level))]).toEqual([
      ...ARTISTIC_LEVEL_VALUES,
    ])
  })
})

// La trampa que este test vigila: birthYearForMaxAge hace seasonYear - edad + 1
// porque el Sub-N de polo mide la edad con otro corte. Artística mide al 31 de
// diciembre, o sea seasonYear - edad. Un año de temporada distinto corre toda
// la tabla en bloque; si alguien reintroduce el +1, acá se ve.
describe("los años se corren con el año de la temporada", () => {
  it("2027 corre todas las categorías exactamente un año", () => {
    const dosMilVeintiseis = levelCategoryPreset(2026)
    const dosMilVeintisiete = levelCategoryPreset(2027)
    expect(dosMilVeintisiete).toHaveLength(dosMilVeintiseis.length)
    for (const [index, row] of dosMilVeintisiete.entries()) {
      const previo = dosMilVeintiseis[index]
      expect(row.label).toBe(previo.label)
      expect(row.from).toBe(previo.from === null ? null : previo.from + 1)
      expect(row.to).toBe(previo.to === null ? null : previo.to + 1)
      expect(row.maleFrom).toBe(
        previo.maleFrom === null ? null : previo.maleFrom + 1
      )
    }
  })
})

describe("parseLevelCategories", () => {
  const valida: LevelCategoryDraft[] = [
    { level: "BASICO", label: "Juvenil", from: 2011, to: 2013, maleFrom: 2010 },
    { level: "AVANZADO", label: "Senior", from: null, to: 2011, maleFrom: null },
  ]

  it("acepta lo que manda el formulario", () => {
    expect(parseLevelCategories(JSON.stringify(valida))).toEqual(valida)
  })

  it("acepta un arreglo vacío: es un evento sin categorías todavía", () => {
    expect(parseLevelCategories("[]")).toEqual([])
  })

  it.each([
    ["no es JSON", "{"],
    ["no es un arreglo", '{"level":"BASICO"}'],
    ["nivel desconocido", '[{"level":"MASTER","label":"A","from":null,"to":null,"maleFrom":null}]'],
    ["etiqueta vacía", '[{"level":"BASICO","label":"  ","from":null,"to":null,"maleFrom":null}]'],
    ["año fuera de rango", '[{"level":"BASICO","label":"A","from":1800,"to":null,"maleFrom":null}]'],
    ["año no entero", '[{"level":"BASICO","label":"A","from":2011.5,"to":null,"maleFrom":null}]'],
    ["desde mayor que hasta", '[{"level":"BASICO","label":"A","from":2013,"to":2011,"maleFrom":null}]'],
    ["varones desde mayor que hasta", '[{"level":"BASICO","label":"A","from":2011,"to":2013,"maleFrom":2014}]'],
  ])("rechaza cuando %s", (_caso, json) => {
    expect(parseLevelCategories(json)).toBeNull()
  })

  it("recorta los espacios de la etiqueta", () => {
    const json = '[{"level":"BASICO","label":"  Juvenil  ","from":null,"to":null,"maleFrom":null}]'
    expect(parseLevelCategories(json)?.[0].label).toBe("Juvenil")
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/lib/artistic-levels.test.ts`
Expected: FAIL — «Failed to resolve import "./artistic-levels"».

- [ ] **Step 3: Escribir el módulo**

Crear `src/lib/artistic-levels.ts`:

```ts
// El campeonato de niveles de natación artística separa a los mismos
// deportistas en tres niveles técnicos, y cada nivel tiene su propia tabla de
// categorías por edad. Acá viven esas tablas, tal como las publican las «Bases
// Generales del Campeonato de Niveles», y la aritmética que las convierte en
// años de nacimiento.
//
// Es el gemelo de lib/league.ts: puro, sin Prisma, porque lo usan el formulario
// del admin y la server action, y porque así se puede verificar contra el PDF
// de las bases sin levantar una base de datos.

export const ARTISTIC_LEVEL_VALUES = ["BASICO", "INTERMEDIO", "AVANZADO"] as const

export type ArtisticLevelValue = (typeof ARTISTIC_LEVEL_VALUES)[number]

export const ARTISTIC_LEVEL_LABELS: Record<ArtisticLevelValue, string> = {
  BASICO: "Básico",
  INTERMEDIO: "Intermedio",
  AVANZADO: "Avanzado",
}

export function isArtisticLevel(value: unknown): value is ArtisticLevelValue {
  return (
    typeof value === "string" &&
    (ARTISTIC_LEVEL_VALUES as readonly string[]).includes(value)
  )
}

/** Una categoría de un nivel, ya resuelta a años de nacimiento. */
export interface LevelCategoryDraft {
  level: ArtisticLevelValue
  label: string
  /** Año de nacimiento más viejo admitido. null = sin tope por arriba. */
  from: number | null
  /** Año de nacimiento más joven admitido. null = sin tope por abajo. */
  to: number | null
  /**
   * El 'desde' que aplica a varones cuando las bases les dan un año más que a
   * damas (Juvenil, Junior). null = mismo rango para todos.
   */
  maleFrom: number | null
}

const MIN_YEAR = 1950
const MAX_YEAR = 2050
const MAX_LABEL = 80

// Las bases describen las categorías por EDAD, no por año, porque la tabla se
// reescribe cada temporada. Guardamos la edad y calculamos el año: así el
// formulario sirve igual en 2027 sin que nadie edite este archivo.
interface AgeBand {
  label: string
  /** Edad del deportista más viejo admitido. null = sin tope. */
  oldestAge: number | null
  /** Edad del más joven admitido. null = sin piso. */
  youngestAge: number | null
  /** Edad del varón más viejo admitido, cuando las bases le dan un año más. */
  maleOldestAge: number | null
}

// Sección VI de las bases. Básico e intermedio comparten esta tabla.
const BASICO_E_INTERMEDIO: AgeBand[] = [
  { label: "Infantil D", oldestAge: 8, youngestAge: null, maleOldestAge: null },
  { label: "Infantil A", oldestAge: 10, youngestAge: 9, maleOldestAge: null },
  { label: "Infantil B", oldestAge: 12, youngestAge: 11, maleOldestAge: null },
  // F: 13-15, M: 13-16. El varón de 16 entra por maleOldestAge.
  { label: "Juvenil", oldestAge: 15, youngestAge: 13, maleOldestAge: 16 },
  { label: "Junior/Senior", oldestAge: null, youngestAge: 15, maleOldestAge: null },
]

const AVANZADO: AgeBand[] = [
  { label: "12 y menos", oldestAge: 12, youngestAge: null, maleOldestAge: null },
  { label: "Juvenil", oldestAge: 15, youngestAge: 13, maleOldestAge: 16 },
  // F: 15-19, M: 15-20.
  { label: "Junior", oldestAge: 19, youngestAge: 15, maleOldestAge: 20 },
  // Junior y Senior se superponen a propósito: así lo dicen las bases. No
  // estorba porque la categoría es una etiqueta y la elegibilidad la decide el
  // rango de años de cada prueba.
  { label: "Senior", oldestAge: null, youngestAge: 15, maleOldestAge: null },
]

const BANDS_BY_LEVEL: Record<ArtisticLevelValue, AgeBand[]> = {
  BASICO: BASICO_E_INTERMEDIO,
  INTERMEDIO: BASICO_E_INTERMEDIO,
  AVANZADO,
}

// Las bases miden la edad al 31 de diciembre del año del campeonato, así que
// el año de nacimiento es seasonYear - edad, sin el +1 de birthYearForMaxAge
// (que existe porque el "Sub-N" de polo mide con otro corte).
function birthYear(seasonYear: number, age: number | null): number | null {
  return age === null ? null : seasonYear - age
}

/** Las categorías de los tres niveles para una temporada. */
export function levelCategoryPreset(seasonYear: number): LevelCategoryDraft[] {
  return ARTISTIC_LEVEL_VALUES.flatMap((level) =>
    BANDS_BY_LEVEL[level].map((band) => ({
      level,
      label: band.label,
      from: birthYear(seasonYear, band.oldestAge),
      to: birthYear(seasonYear, band.youngestAge),
      maleFrom: birthYear(seasonYear, band.maleOldestAge),
    }))
  )
}

function readYear(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value)) return "invalid"
  const year = value as number
  return year < MIN_YEAR || year > MAX_YEAR ? "invalid" : year
}

/**
 * Lee las categorías por nivel que manda el formulario. Se valida en el
 * servidor porque los campos ocultos también se manipulan desde el navegador,
 * igual que parseLeagueTeamCounts.
 */
export function parseLevelCategories(value: string): LevelCategoryDraft[] | null {
  let rows: unknown
  try {
    rows = JSON.parse(value)
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null

  const parsed: LevelCategoryDraft[] = []
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null
    const candidate = row as Record<string, unknown>

    if (!isArtisticLevel(candidate.level)) return null
    if (typeof candidate.label !== "string") return null
    const label = candidate.label.trim()
    if (!label || label.length > MAX_LABEL) return null

    const from = readYear(candidate.from)
    const to = readYear(candidate.to)
    const maleFrom = readYear(candidate.maleFrom)
    if (from === "invalid" || to === "invalid" || maleFrom === "invalid") {
      return null
    }
    if (from !== null && to !== null && from > to) return null
    if (maleFrom !== null && to !== null && maleFrom > to) return null

    parsed.push({ level: candidate.level, label, from, to, maleFrom })
  }
  return parsed
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/lib/artistic-levels.test.ts`
Expected: PASS, todos los casos.

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/lib/artistic-levels.ts src/lib/artistic-levels.test.ts
git commit -m "Agrega las tablas de categorias por nivel de artistica"
```

---

### Task 2: La migración y el esquema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260818120000_campeonato_de_niveles/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `Event.isLevelChampionship: boolean`, `EventModality.level: ArtisticLevel | null`, y el tipo `ArtisticLevel` en `@prisma/client`.

> **Nota sobre el enum:** el README advierte que PostgreSQL no deja usar un valor de enum en la misma transacción en que se agregó. Eso aplica a `ALTER TYPE … ADD VALUE` sobre un enum que ya existe. Acá se **crea un tipo nuevo**, y crear y usar un tipo nuevo en la misma migración sí se puede. No hace falta partirla en dos.

- [ ] **Step 1: Agregar el enum y los campos al esquema**

En `prisma/schema.prisma`, después de `enum AgeRuleMode`:

```prisma
// Nivel técnico dentro de un campeonato de niveles de natación artística. Los
// tres compiten el mismo día con categorías por edad propias. Null = la prueba
// no pertenece a un campeonato de niveles, que es el caso de todo lo demás.
enum ArtisticLevel {
  BASICO
  INTERMEDIO
  AVANZADO
}
```

En `model Event`, justo debajo de `isLeague`:

```prisma
  // Un campeonato de niveles separa a los deportistas en básico, intermedio y
  // avanzado, cada uno con sus categorías. Hoy solo aplica a artística.
  isLevelChampionship  Boolean      @default(false)
```

En `model EventModality`, después de `category`:

```prisma
  // Nivel técnico de la prueba en un campeonato de niveles. El nivel también
  // viaja dentro de `category` («Básico — Infantil A — Damas») para que la
  // descripción de la orden distinga dos pruebas homónimas de niveles
  // distintos; esta columna es la que permite agrupar y filtrar.
  level                    ArtisticLevel?
```

- [ ] **Step 2: Escribir la migración a mano**

Crear `prisma/migrations/20260818120000_campeonato_de_niveles/migration.sql`:

```sql
-- Campeonato de niveles de natacion artistica: basico, intermedio y avanzado
-- compiten el mismo dia con categorias por edad propias.

-- CreateEnum
CREATE TYPE "ArtisticLevel" AS ENUM ('BASICO', 'INTERMEDIO', 'AVANZADO');

-- La bandera nace en false: ningun evento existente cambia de formato.
ALTER TABLE "events"
  ADD COLUMN "isLevelChampionship" BOOLEAN NOT NULL DEFAULT false;

-- Nulo fuera de un campeonato de niveles, que es todo lo que existe hoy.
ALTER TABLE "event_modalities"
  ADD COLUMN "level" "ArtisticLevel";

-- El nivel pertenece exclusivamente a natacion artistica, igual que "sube de
-- categoria". Nace NOT VALID por la misma razon que aquel: el despliegue del
-- esquema no puede fallar por filas legadas. Como la columna arranca en NULL
-- en todas, la validacion es inmediata y no reescribe la tabla.
ALTER TABLE "event_modalities"
ADD CONSTRAINT "event_modalities_level_artistic_check"
CHECK (
    "discipline" = 'ARTISTIC_SWIMMING'
    OR "level" IS NULL
) NOT VALID;

ALTER TABLE "event_modalities"
VALIDATE CONSTRAINT "event_modalities_level_artistic_check";
```

- [ ] **Step 3: Validar el esquema y regenerar el cliente**

Run: `npx prisma validate && npx prisma generate`
Expected: «The schema at prisma/schema.prisma is valid» y el cliente regenerado.

- [ ] **Step 4: Aplicar la migración**

Run: `npx prisma migrate dev`
Expected: aplica `20260818120000_campeonato_de_niveles` y **no** propone crear otra migración. Si Prisma dice que hay drift, revisá que el SQL coincida exactamente con el esquema del Step 1.

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260818120000_campeonato_de_niveles
git commit -m "Agrega el formato de campeonato de niveles al esquema"
```

---

### Task 3: Sacar `buildModalityRows` a un módulo propio

Hoy `buildModalityRows` vive dentro de `actions.ts`, que lleva `"use server"` y por lo tanto **solo puede exportar funciones async**. Mientras siga ahí no se puede testear, y la Task 4 le agrega una regla de elegibilidad que no puede quedar sin test. Este paso es un movimiento puro: mismo código, mismo comportamiento.

**Files:**
- Create: `src/lib/modality-rows.ts`
- Create: `src/lib/modality-rows.test.ts`
- Modify: `src/app/admin/eventos/actions.ts:47-115` (borrar `SEX_SUFFIX` y `buildModalityRows`, importarlos)

**Interfaces:**
- Consumes: `CategorySpec` de `src/lib/event-categories.ts`, `LeagueCategoryPlan` y `leagueEntryPrice` de `src/lib/league.ts`.
- Produces:
  - `SEX_SUFFIX: Record<string, string>`
  - `buildModalityRows(input: BuildModalityRowsInput): Prisma.EventModalityCreateManyEventInput[]`
  - `interface BuildModalityRowsInput` con los campos `discipline`, `names`, `categories`, `variantsFor`, `price`, `leaguePlanFor?`, `allowsCategoryUpgrade`, `startSortOrder`.

- [ ] **Step 1: Escribir el test de caracterización**

Crear `src/lib/modality-rows.test.ts`. Fija el comportamiento **actual** para que la Task 4 no pueda cambiarlo sin querer:

```ts
import { describe, expect, it } from "vitest"
import type { CategorySpec } from "./event-categories"
import { buildModalityRows } from "./modality-rows"

function category(overrides: Partial<CategorySpec> = {}): CategorySpec {
  return {
    label: "Juvenil",
    birthYearFrom: 2011,
    birthYearTo: 2013,
    maxAgeYears: null,
    ...overrides,
  }
}

const individual = {
  sexRules: ["FEMALE", "MALE"] as const,
  minAthletes: 1,
  maxAthletes: 1,
}

describe("buildModalityRows", () => {
  it("multiplica pruebas × categorías × sexos", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre", "Figuras"],
      categories: [category(), category({ label: "Infantil A" })],
      variantsFor: () => ({ ...individual, sexRules: [...individual.sexRules] }),
      price: 60,
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
    expect(rows).toHaveLength(8)
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it("arma la etiqueta como «categoría — sexo»", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [category()],
      variantsFor: () => ({ ...individual, sexRules: [...individual.sexRules] }),
      price: 60,
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
    expect(rows.map((row) => row.category)).toEqual([
      "Juvenil — Damas",
      "Juvenil — Varones",
    ])
  })

  it("una categoría sin etiqueta deja category en null", () => {
    const rows = buildModalityRows({
      discipline: "DIVING",
      names: ["Plataforma"],
      categories: [
        { label: null, birthYearFrom: null, birthYearTo: null, maxAgeYears: null },
      ],
      variantsFor: () => ({ sexRules: ["ANY"], minAthletes: 1, maxAthletes: 1 }),
      price: 40,
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
    expect(rows[0].category).toBeNull()
  })

  it("sin tope de año no concede «sube de categoría»", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [category({ birthYearTo: null })],
      variantsFor: () => ({ sexRules: ["FEMALE"], minAthletes: 1, maxAthletes: 1 }),
      price: 60,
      allowsCategoryUpgrade: true,
      startSortOrder: 0,
    })
    expect(rows[0].allowsCategoryUpgrade).toBe(false)
    expect(rows[0].categoryUpgradeBirthYear).toBeNull()
  })

  it("con tope de año el año que sube es birthYearTo + 1", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [category()],
      variantsFor: () => ({ sexRules: ["FEMALE"], minAthletes: 1, maxAthletes: 1 }),
      price: 60,
      allowsCategoryUpgrade: true,
      startSortOrder: 0,
    })
    expect(rows[0].allowsCategoryUpgrade).toBe(true)
    expect(rows[0].categoryUpgradeBirthYear).toBe(2014)
  })

  it("en una liga el precio sale de los partidos del equipo", () => {
    const rows = buildModalityRows({
      discipline: "WATER_POLO",
      names: ["Plantel"],
      categories: [category()],
      variantsFor: () => ({ sexRules: ["FEMALE"], minAthletes: 7, maxAthletes: 13 }),
      price: 0,
      leaguePlanFor: () => ({
        pricePerMatch: 50,
        matchesPerTeam: 4,
        expectedTeams: 6,
      }),
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
    expect(rows[0].price.toString()).toBe("200")
    expect(rows[0].matchesPerTeam).toBe(4)
    expect(rows[0].expectedTeams).toBe(6)
  })

  it("respeta el sortOrder inicial que le pasan", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [category()],
      variantsFor: () => ({ sexRules: ["FEMALE"], minAthletes: 1, maxAthletes: 1 }),
      price: 60,
      allowsCategoryUpgrade: false,
      startSortOrder: 12,
    })
    expect(rows[0].sortOrder).toBe(12)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/lib/modality-rows.test.ts`
Expected: FAIL — «Failed to resolve import "./modality-rows"».

- [ ] **Step 3: Crear el módulo moviendo el código tal cual**

Crear `src/lib/modality-rows.ts` con el contenido que hoy está en `src/app/admin/eventos/actions.ts:47-115`, **sin cambiarle una línea de lógica**:

```ts
import { Prisma, type Discipline, type SexRule } from "@prisma/client"
import type { CategorySpec } from "./event-categories"
import { leagueEntryPrice, type LeagueCategoryPlan } from "./league"

// Vive en lib/ y no en la server action porque un archivo "use server" solo
// puede exportar funciones async, y esta matriz es el corazón de la
// elegibilidad de cada prueba: tiene que poder testearse sola.

export const SEX_SUFFIX: Record<string, string> = {
  MALE: "Varones",
  FEMALE: "Damas",
  MIXED: "Mixto",
  ANY: "",
}

export interface BuildModalityRowsInput {
  discipline: Discipline
  names: string[]
  categories: CategorySpec[]
  variantsFor: (name: string) => {
    sexRules: SexRule[]
    minAthletes: number
    maxAthletes: number
  }
  price: number
  leaguePlanFor?: (categoryIndex: number, sexRule: SexRule) => LeagueCategoryPlan
  allowsCategoryUpgrade: boolean
  startSortOrder: number
}

/**
 * Matriz pruebas × categorías × sexos. La comparten el generador masivo y la
 * creación de eventos, para que las pruebas nacidas en cualquiera de los dos
 * caminos queden idénticas.
 */
export function buildModalityRows(
  input: BuildModalityRowsInput
): Prisma.EventModalityCreateManyEventInput[] {
  const rows: Prisma.EventModalityCreateManyEventInput[] = []
  let sortOrder = input.startSortOrder

  for (const [categoryIndex, category] of input.categories.entries()) {
    for (const name of input.names) {
      const variant = input.variantsFor(name)
      for (const sexRule of variant.sexRules) {
        const leaguePlan = input.leaguePlanFor?.(categoryIndex, sexRule)
        const label = [category.label, SEX_SUFFIX[sexRule]].filter(Boolean).join(" — ")
        // Sin tope de año no hay categoría inferior que pueda subir: la más alta
        // del lote se genera sin el permiso.
        const upgrades = input.allowsCategoryUpgrade && category.birthYearTo !== null
        rows.push({
          discipline: input.discipline,
          name,
          category: label || null,
          sexRule,
          birthYearFrom: category.birthYearFrom,
          birthYearTo: category.birthYearTo,
          allowsCategoryUpgrade: upgrades,
          categoryUpgradeBirthYear: upgrades ? category.birthYearTo! + 1 : null,
          minAthletes: variant.minAthletes,
          maxAthletes: variant.maxAthletes,
          price: new Prisma.Decimal(
            (leaguePlan ? leagueEntryPrice(leaguePlan) : input.price).toFixed(2)
          ),
          ...(leaguePlan
            ? {
                pricePerMatch: new Prisma.Decimal(
                  leaguePlan.pricePerMatch.toFixed(2)
                ),
                matchesPerTeam: leaguePlan.matchesPerTeam,
                expectedTeams: leaguePlan.expectedTeams,
              }
            : {}),
          sortOrder: sortOrder++,
        })
      }
    }
  }

  return rows
}
```

- [ ] **Step 4: Borrar el original de `actions.ts` e importar**

En `src/app/admin/eventos/actions.ts`:
1. Borrar el bloque `const SEX_SUFFIX = { … }` y toda la función `buildModalityRows` (las líneas 47-115 actuales, entre `parseFee` y `parseDateOnly`).
2. Agregar el import junto a los demás de `@/lib`:

```ts
import { buildModalityRows } from "@/lib/modality-rows"
```

3. Si `Prisma`, `SexRule` o `leagueEntryPrice` quedan sin uso, el linter lo dirá en el Step 6. `Prisma` y `leagueEntryPrice` siguen usándose en otras partes del archivo; no los borres sin verificar.

- [ ] **Step 5: Correr los tests**

Run: `npm test`
Expected: PASS, incluida toda la suite previa. Ninguna prueba existente debería cambiar: este paso no altera comportamiento.

- [ ] **Step 6: Lint y tipos**

Run: `npm run lint && npx tsc --noEmit`
Expected: sin errores. Si aparece un import sin usar en `actions.ts`, borralo.

- [ ] **Step 7: Commit**

```bash
git add src/lib/modality-rows.ts src/lib/modality-rows.test.ts src/app/admin/eventos/actions.ts
git commit -m "Saca buildModalityRows a lib para poder testearla"
```

---

### Task 4: El rango masculino extendido

Juvenil y Junior admiten un año más en varones que en damas. Como `buildModalityRows` ya itera los sexos dentro de cada categoría, alcanza con que la categoría lleve el dato.

**Files:**
- Modify: `src/lib/event-categories.ts` (agregar `maleBirthYearFrom` a `CategorySpec` y devolverlo en `null` en los dos parsers)
- Modify: `src/lib/modality-rows.ts` (consultarlo)
- Modify: `src/lib/modality-rows.test.ts` (casos nuevos)

**Interfaces:**
- Consumes: `buildModalityRows` de la Task 3.
- Produces: `CategorySpec.maleBirthYearFrom: number | null`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `src/lib/modality-rows.test.ts`:

```ts
// Las bases dan a los varones un año más en Juvenil (F 13-15, M 13-16) y en
// Junior (F 15-19, M 15-20). Sin esto, un nadador de 2010 no entra a juvenil.
describe("el rango masculino extendido", () => {
  const juvenil: CategorySpec = {
    label: "Juvenil",
    birthYearFrom: 2011,
    birthYearTo: 2013,
    maxAgeYears: null,
    maleBirthYearFrom: 2010,
  }

  function rowsFor(sexRules: readonly string[]) {
    return buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [juvenil],
      variantsFor: () => ({
        sexRules: sexRules as never,
        minAthletes: 1,
        maxAthletes: 1,
      }),
      price: 60,
      allowsCategoryUpgrade: false,
      startSortOrder: 0,
    })
  }

  it("damas conservan el rango de la categoría", () => {
    expect(rowsFor(["FEMALE"])[0].birthYearFrom).toBe(2011)
  })

  it.each(["MALE", "MIXED", "ANY"])(
    "%s admite además al varón del año extra",
    (sexRule) => {
      expect(rowsFor([sexRule])[0].birthYearFrom).toBe(2010)
    }
  )

  it("el tope joven no se desdobla: es el mismo para todos", () => {
    for (const sexRule of ["FEMALE", "MALE", "MIXED", "ANY"]) {
      expect(rowsFor([sexRule])[0].birthYearTo).toBe(2013)
    }
  })

  it("sin rango masculino todos los sexos usan el de la categoría", () => {
    const sinExtra = { ...juvenil, maleBirthYearFrom: null }
    for (const sexRule of ["FEMALE", "MALE", "MIXED", "ANY"]) {
      const rows = buildModalityRows({
        discipline: "ARTISTIC_SWIMMING",
        names: ["Solo Libre"],
        categories: [sinExtra],
        variantsFor: () => ({
          sexRules: [sexRule] as never,
          minAthletes: 1,
          maxAthletes: 1,
        }),
        price: 60,
        allowsCategoryUpgrade: false,
        startSortOrder: 0,
      })
      expect(rows[0].birthYearFrom).toBe(2011)
    }
  })

  it("«sube de categoría» sigue saliendo del tope joven, no del masculino", () => {
    const rows = buildModalityRows({
      discipline: "ARTISTIC_SWIMMING",
      names: ["Solo Libre"],
      categories: [juvenil],
      variantsFor: () => ({ sexRules: ["MALE"], minAthletes: 1, maxAthletes: 1 }),
      price: 60,
      allowsCategoryUpgrade: true,
      startSortOrder: 0,
    })
    expect(rows[0].categoryUpgradeBirthYear).toBe(2014)
  })
})
```

También hay que actualizar el helper `category()` del principio del archivo para que incluya el campo nuevo:

```ts
function category(overrides: Partial<CategorySpec> = {}): CategorySpec {
  return {
    label: "Juvenil",
    birthYearFrom: 2011,
    birthYearTo: 2013,
    maxAgeYears: null,
    maleBirthYearFrom: null,
    ...overrides,
  }
}
```

Y el objeto literal del test «una categoría sin etiqueta deja category en null» necesita `maleBirthYearFrom: null`.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- src/lib/modality-rows.test.ts`
Expected: FAIL — errores de tipo por `maleBirthYearFrom` inexistente en `CategorySpec`, y los casos `MALE`/`MIXED`/`ANY` devolviendo 2011 en vez de 2010.

- [ ] **Step 3: Agregar el campo a `CategorySpec`**

En `src/lib/event-categories.ts`, dentro de `interface CategorySpec`, después de `maxAgeYears`:

```ts
  /**
   * Solo en natación artística: el 'desde' que aplica a varones cuando las
   * bases les dan un año más que a damas (Juvenil, Junior). null = mismo rango
   * para todos, que es el caso de todas las demás disciplinas.
   */
  maleBirthYearFrom: number | null
```

Después agregar `maleBirthYearFrom: null` a **los cuatro** literales que construyen un `CategorySpec` en ese archivo:
- el `categories.push({ … })` de `parseRangeCategories`
- los dos `categories.push({ … })` de `parseMaxAgeCategories` (el de `OPEN` y el de `Sub-N`)
- la categoría nula que devuelve `parseCategorySpecs` cuando el texto viene vacío

- [ ] **Step 4: Consultarlo en `buildModalityRows`**

En `src/lib/modality-rows.ts`, dentro del bucle de sexos, antes del `rows.push`:

```ts
        // Damas usan el rango de la categoría; el resto admite además al varón
        // del año extra que dan las bases. MIXED lleva un varón, y ANY admite a
        // cualquiera, así que ninguno puede ser más estrecho que MALE.
        const birthYearFrom =
          sexRule === "FEMALE"
            ? category.birthYearFrom
            : (category.maleBirthYearFrom ?? category.birthYearFrom)
```

Y reemplazar la línea `birthYearFrom: category.birthYearFrom,` del `rows.push` por:

```ts
          birthYearFrom,
```

- [ ] **Step 5: Correr los tests**

Run: `npm test`
Expected: PASS. Los tests de caracterización de la Task 3 siguen verdes: sin `maleBirthYearFrom` nada cambia.

- [ ] **Step 6: Lint y tipos**

Run: `npm run lint && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/lib/event-categories.ts src/lib/modality-rows.ts src/lib/modality-rows.test.ts
git commit -m "Permite que una categoria admita un anio mas en varones"
```

---

### Task 5: `saveEvent` genera las pruebas por nivel

**Files:**
- Modify: `src/app/admin/eventos/actions.ts` (`eventSchema`, el cuerpo de `saveEvent`)
- Test: `src/lib/artistic-levels.test.ts` (los casos de composición de etiqueta van al lib, ver más abajo)

**Interfaces:**
- Consumes: `parseLevelCategories`, `ARTISTIC_LEVEL_VALUES`, `ARTISTIC_LEVEL_LABELS` (Task 1); `buildModalityRows` (Task 3/4); `Event.isLevelChampionship`, `EventModality.level` (Task 2).
- Produces: el campo de formulario `isLevelChampionship` (checkbox, `"on"`) y `presetLevelCategories` (hidden, JSON), consumidos por la Task 6.

- [ ] **Step 1: Escribir el test que falla**

Las guardas viven en una server action que toca la base, así que lo que se testea unitariamente es la conversión pura. Agregar a `src/lib/artistic-levels.test.ts`:

```ts
import { levelCategoriesToSpecs } from "./artistic-levels"

describe("levelCategoriesToSpecs", () => {
  it("agrupa por nivel en el orden básico → intermedio → avanzado", () => {
    const grupos = levelCategoriesToSpecs([
      { level: "AVANZADO", label: "Senior", from: null, to: 2011, maleFrom: null },
      { level: "BASICO", label: "Juvenil", from: 2011, to: 2013, maleFrom: 2010 },
    ])
    expect(grupos.map((grupo) => grupo.level)).toEqual(["BASICO", "AVANZADO"])
  })

  it("antepone el nombre del nivel a la etiqueta de la categoría", () => {
    const [grupo] = levelCategoriesToSpecs([
      { level: "BASICO", label: "Infantil A", from: 2016, to: 2017, maleFrom: null },
    ])
    expect(grupo.specs[0].label).toBe("Básico — Infantil A")
  })

  it("traslada los años y el rango masculino al CategorySpec", () => {
    const [grupo] = levelCategoriesToSpecs([
      { level: "BASICO", label: "Juvenil", from: 2011, to: 2013, maleFrom: 2010 },
    ])
    expect(grupo.specs[0]).toMatchObject({
      birthYearFrom: 2011,
      birthYearTo: 2013,
      maleBirthYearFrom: 2010,
      maxAgeYears: null,
    })
  })

  it("omite los niveles sin categorías", () => {
    const grupos = levelCategoriesToSpecs([
      { level: "BASICO", label: "Juvenil", from: 2011, to: 2013, maleFrom: null },
    ])
    expect(grupos).toHaveLength(1)
  })

  it("una lista vacía no produce ningún grupo", () => {
    expect(levelCategoriesToSpecs([])).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/lib/artistic-levels.test.ts`
Expected: FAIL — «levelCategoriesToSpecs is not a function».

- [ ] **Step 3: Agregar `levelCategoriesToSpecs` al lib**

En `src/lib/artistic-levels.ts`, agregar el import y la función al final:

```ts
import type { CategorySpec } from "./event-categories"

export interface LevelCategoryGroup {
  level: ArtisticLevelValue
  specs: CategorySpec[]
}

/**
 * Convierte las categorías del formulario en los grupos que consume
 * buildModalityRows, uno por nivel y en el orden en que compiten.
 *
 * El nombre del nivel se antepone a la etiqueta porque la descripción de la
 * orden se arma con `category` (ver lib/registration-snapshots.ts): sin él, dos
 * pruebas homónimas de niveles distintos aparecerían idénticas en el
 * comprobante que paga el club.
 */
export function levelCategoriesToSpecs(
  categories: LevelCategoryDraft[]
): LevelCategoryGroup[] {
  const groups: LevelCategoryGroup[] = []
  for (const level of ARTISTIC_LEVEL_VALUES) {
    const specs = categories
      .filter((category) => category.level === level)
      .map<CategorySpec>((category) => ({
        label: `${ARTISTIC_LEVEL_LABELS[level]} — ${category.label}`,
        birthYearFrom: category.from,
        birthYearTo: category.to,
        maxAgeYears: null,
        maleBirthYearFrom: category.maleFrom,
      }))
    if (specs.length > 0) groups.push({ level, specs })
  }
  return groups
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/lib/artistic-levels.test.ts`
Expected: PASS.

- [ ] **Step 5: Extender `eventSchema`**

En `src/app/admin/eventos/actions.ts`, dentro de `const eventSchema = z.object({ … })`, después de `isLeague`:

```ts
  isLevelChampionship: z.boolean(),
```

y después de `presetLeagueTeamCounts`:

```ts
  presetLevelCategories: z.string().optional(),
```

En el `safeParse` de `saveEvent`, después de la línea de `isLeague`:

```ts
    isLevelChampionship: formData.get("isLevelChampionship") === "on",
```

y después de la de `presetLeagueTeamCounts`:

```ts
    presetLevelCategories: String(formData.get("presetLevelCategories") ?? ""),
```

- [ ] **Step 6: Agregar las guardas**

Justo después de la guarda de liga (`if (parsed.data.isLeague && discipline !== "WATER_POLO")`):

```ts
  if (parsed.data.isLevelChampionship && discipline !== "ARTISTIC_SWIMMING") {
    return {
      success: false,
      error:
        "Solo un evento de natación artística puede ser un campeonato de niveles.",
    }
  }
```

En el bloque `if (existing) { … }`, después de la guarda de `isLeague`:

```ts
    if (
      hasLockedEntries &&
      existing.isLevelChampionship !== parsed.data.isLevelChampionship
    ) {
      return {
        success: false,
        error:
          "El formato de niveles no puede cambiar porque el evento ya tiene inscripciones en una orden.",
      }
    }
```

Para que esa comparación tenga de dónde leer, agregar `isLevelChampionship: true` al `select` del `prisma.event.findUnique` que arma `existing` (está junto a `isLeague: true`).

Y en el objeto `data`, junto a `isLeague`:

```ts
    isLevelChampionship: parsed.data.isLevelChampionship,
```

- [ ] **Step 7: Generar las pruebas por nivel**

Dentro de `if (chosen.length > 0) { … }`, después de calcular `price` y **antes** del `modalityRows = buildModalityRows({ … })` actual, insertar la rama de niveles:

```ts
      if (parsed.data.isLevelChampionship) {
        // `|| "[]"` y no `?? "[]"`: el safeParse convierte un campo ausente en
        // cadena vacía, no en undefined, y JSON.parse("") revienta.
        const levelCategories = parseLevelCategories(
          parsed.data.presetLevelCategories?.trim() || "[]"
        )
        if (levelCategories === null) {
          return { success: false, error: "Categorías por nivel inválidas." }
        }
        const groups = levelCategoriesToSpecs(levelCategories)
        if (groups.length === 0) {
          return {
            success: false,
            error: "Agrega las categorías de al menos un nivel.",
          }
        }
        // Un nivel por llamada, con el sortOrder corrido: las pruebas nacen
        // ordenadas básico → intermedio → avanzado sin que ninguna vista tenga
        // que ordenarlas después.
        for (const group of groups) {
          const levelRows = buildModalityRows({
            discipline,
            names: chosen.map((modality) => modality.name),
            categories: group.specs,
            variantsFor: (name) => {
              const modality = chosen.find((row) => row.name === name)!
              return {
                sexRules: modality.sexRules as SexRule[],
                minAthletes: modality.minAthletes,
                maxAthletes: modality.maxAthletes,
              }
            },
            price,
            allowsCategoryUpgrade: false,
            startSortOrder: modalityRows.length,
          })
          modalityRows.push(
            ...levelRows.map((row) => ({ ...row, level: group.level }))
          )
        }
      }
```

Y después de ese bloque, envolver la asignación `modalityRows = buildModalityRows({ … })` **que ya existe** en el `else` correspondiente, sin tocarle nada por dentro:

```ts
      else {
        modalityRows = buildModalityRows({
          // … exactamente el objeto que ya está en el archivo, sin cambios …
        })
      }
```

La comprobación de `MAX_BULK_MODALITIES` que viene justo después queda igual y ya cubre la suma de los tres niveles, porque mide `modalityRows.length`.

Agregar los imports que faltan arriba del archivo:

```ts
import {
  levelCategoriesToSpecs,
  parseLevelCategories,
} from "@/lib/artistic-levels"
```

- [ ] **Step 8: Correr toda la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Lint, tipos y esquema**

Run: `npm run lint && npx tsc --noEmit && npx prisma validate`
Expected: sin errores.

- [ ] **Step 10: Verificar las guardas a mano**

`saveEvent` es una server action que toca la base, y `npm test` es unitario sin
base de datos: el repo no tiene arnés para testearla. Las dos guardas nuevas se
verifican a mano una vez, acá, y quedan registradas.

Run: `npm run dev`. Con las herramientas de desarrollador, en `/admin/eventos`:

1. Crear un evento de **clavados** y, antes de enviar, agregar a mano el campo
   `isLevelChampionship=on` al `FormData` del envío.
   Esperado: «Solo un evento de natación artística puede ser un campeonato de
   niveles.»
2. Tomar un evento de artística que ya tenga una inscripción en una orden
   (`PENDING_PAYMENT` o `PAID`), editarlo y cambiarle la marca de niveles.
   Esperado: «El formato de niveles no puede cambiar porque el evento ya tiene
   inscripciones en una orden.»

Si alguno de los dos pasa sin error, la guarda está mal puesta: revisá que la
primera esté junto a la de liga (antes del `findUnique`) y la segunda dentro
del bloque `if (existing)`.

- [ ] **Step 11: Commit**

```bash
git add src/lib/artistic-levels.ts src/lib/artistic-levels.test.ts src/app/admin/eventos/actions.ts
git commit -m "Genera las pruebas de un campeonato de niveles por nivel"
```

---

### Task 6: La casilla y las tres secciones del formulario

**Files:**
- Modify: `src/app/admin/eventos/event-form-dialog.tsx`

**Interfaces:**
- Consumes: `levelCategoryPreset`, `ARTISTIC_LEVEL_VALUES`, `ARTISTIC_LEVEL_LABELS`, `LevelCategoryDraft` (Task 1); los campos `isLevelChampionship` y `presetLevelCategories` (Task 5).
- Produces: `EventFormData.isLevelChampionship: boolean`, que `src/app/admin/eventos/[id]/page.tsx` tiene que pasar (Step 7).

- [ ] **Step 1: Agregar el campo al tipo del formulario**

En `interface EventFormData`, después de `isLeague`:

```ts
  isLevelChampionship: boolean
```

- [ ] **Step 2: Agregar el estado y la precarga**

Después de `const [isLeague, setIsLeague] = useState(...)`:

```ts
  const [isLevelChampionship, setIsLevelChampionship] = useState(
    event?.isLevelChampionship ?? false
  )
  const [seasonId, setSeasonId] = useState(
    event?.seasonId || seasons.find((season) => season.isCurrent)?.id || ""
  )
  const [levelRows, setLevelRows] = useState<LevelCategoryDraft[]>([])
```

El año de la temporada elegida es lo que alimenta la precarga:

```ts
  const seasonYear = seasons.find((season) => season.id === seasonId)?.year ?? null
```

Y la función que carga las categorías de las bases:

```ts
  // Las bases publican las categorías por edad; el año de la temporada las
  // convierte en años de nacimiento. Es un punto de partida editable: si las
  // bases cambian, el admin corrige sin esperar un despliegue.
  function loadLevelPreset(year: number | null) {
    setLevelRows(year === null ? [] : levelCategoryPreset(year))
  }
```

- [ ] **Step 3: Conectar la casilla y el selector de temporada**

En `chooseDiscipline`, después de `setIsLeague(false)`:

```ts
    setIsLevelChampionship(false)
    setLevelRows([])
```

El `Select` de temporada tiene que pasar a controlado, para que cambiar de temporada recalcule la precarga. Reemplazar su `defaultValue` por:

```tsx
          value={seasonId}
          onChange={(e) => {
            setSeasonId(e.target.value)
            const year = seasons.find((season) => season.id === e.target.value)?.year
            if (isLevelChampionship) loadLevelPreset(year ?? null)
          }}
```

- [ ] **Step 4: Agregar la casilla**

Justo después del bloque `{discipline === "WATER_POLO" ? ( … ) : null}`:

```tsx
            {discipline === "ARTISTIC_SWIMMING" ? (
              <label className="flex items-start gap-2.5 rounded-control border border-fdnda-border bg-white px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  name="isLevelChampionship"
                  checked={isLevelChampionship}
                  onChange={(e) => {
                    setIsLevelChampionship(e.target.checked)
                    loadLevelPreset(e.target.checked ? seasonYear : null)
                  }}
                  className="mt-0.5 h-4 w-4 accent-fdnda-turquoise-deep"
                />
                <span>
                  <span className="font-medium text-fdnda-ink">
                    Es un campeonato de niveles
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-fdnda-muted">
                    Básico, intermedio y avanzado compiten con categorías por
                    edad propias. Se cargan las de las bases y puedes editarlas.
                  </span>
                </span>
              </label>
            ) : null}
```

- [ ] **Step 5: Las tres secciones de categorías**

Dentro del bloque `{!event ? ( … )}`, envolver el bloque de categorías actual en un condicional. Cuando `isLevelChampionship` es `true`, en vez de la lista plana va esto:

```tsx
                      <input
                        type="hidden"
                        name="presetLevelCategories"
                        value={JSON.stringify(levelRows)}
                      />
                      {ARTISTIC_LEVEL_VALUES.map((level) => (
                        <div
                          key={level}
                          className="rounded-control border border-fdnda-border bg-white p-3"
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-fdnda-muted">
                              {ARTISTIC_LEVEL_LABELS[level]}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setLevelRows((current) => [
                                  ...current,
                                  {
                                    level,
                                    label: "",
                                    from: null,
                                    to: null,
                                    maleFrom: null,
                                  },
                                ])
                              }
                            >
                              <Plus className="h-4 w-4" aria-hidden="true" />
                              Agregar categoría
                            </Button>
                          </div>
                          {levelRows.filter((row) => row.level === level).length ===
                          0 ? (
                            <p className="text-xs text-fdnda-muted">
                              Sin categorías: este nivel no genera pruebas.
                            </p>
                          ) : null}
                          <div className="space-y-2">
                            {levelRows.map((row, index) =>
                              row.level !== level ? null : (
                                <div
                                  key={index}
                                  className="grid items-end gap-2 sm:grid-cols-[minmax(9rem,1.4fr)_repeat(3,minmax(6rem,1fr))_auto]"
                                >
                                  <div>
                                    <Label htmlFor={`lv-label-${index}`}>
                                      Categoría
                                    </Label>
                                    <Input
                                      id={`lv-label-${index}`}
                                      value={row.label}
                                      onChange={(e) =>
                                        updateLevelRow(index, "label", e.target.value)
                                      }
                                      maxLength={80}
                                      required
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`lv-from-${index}`}>Desde</Label>
                                    <Input
                                      id={`lv-from-${index}`}
                                      type="number"
                                      inputMode="numeric"
                                      min={1950}
                                      max={2050}
                                      value={row.from ?? ""}
                                      onChange={(e) =>
                                        updateLevelRow(index, "from", e.target.value)
                                      }
                                      placeholder="Sin tope"
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`lv-to-${index}`}>Hasta</Label>
                                    <Input
                                      id={`lv-to-${index}`}
                                      type="number"
                                      inputMode="numeric"
                                      min={1950}
                                      max={2050}
                                      value={row.to ?? ""}
                                      onChange={(e) =>
                                        updateLevelRow(index, "to", e.target.value)
                                      }
                                      placeholder="Sin tope"
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor={`lv-male-${index}`}>
                                      Varones desde
                                    </Label>
                                    <Input
                                      id={`lv-male-${index}`}
                                      type="number"
                                      inputMode="numeric"
                                      min={1950}
                                      max={2050}
                                      value={row.maleFrom ?? ""}
                                      onChange={(e) =>
                                        updateLevelRow(index, "maleFrom", e.target.value)
                                      }
                                      placeholder="Igual"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setLevelRows((current) =>
                                        current.filter((_, i) => i !== index)
                                      )
                                    }
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-control text-fdnda-red-deep transition-colors hover:bg-fdnda-red-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-red/30"
                                    aria-label={`Quitar ${row.label || "categoría"}`}
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      ))}
```

Y el helper que edita una fila, junto a `updateCategory`:

```tsx
  function updateLevelRow(
    index: number,
    field: "label" | "from" | "to" | "maleFrom",
    value: string
  ) {
    setLevelRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row
        if (field === "label") return { ...row, label: value }
        // Campo vacío = sin tope de ese lado, que es como las bases expresan
        // «2018 o más» y «2011 o antes».
        const year = value.trim() === "" ? null : Number(value)
        return { ...row, [field]: year }
      })
    )
  }
```

Agregar los imports:

```tsx
import {
  ARTISTIC_LEVEL_LABELS,
  ARTISTIC_LEVEL_VALUES,
  levelCategoryPreset,
  type LevelCategoryDraft,
} from "@/lib/artistic-levels"
```

- [ ] **Step 6: El textarea plano no debe viajar en un campo de niveles**

El `<input type="hidden" name="presetCategoriesText" … >` que ya existe tiene que quedar **fuera** de la rama de niveles: cuando `isLevelChampionship` es `true` no se manda. Envolvelo:

```tsx
                      {isLevelChampionship ? null : (
                        <input
                          type="hidden"
                          name="presetCategoriesText"
                          value={categoriesText}
                        />
                      )}
```

- [ ] **Step 7: Pasar el campo desde la página del evento**

En `src/app/admin/eventos/[id]/page.tsx`, buscar dónde se arma el objeto `EventFormData` (el que se le pasa a `EditEventButton`) y agregar, junto a `isLeague`:

```ts
    isLevelChampionship: event.isLevelChampionship,
```

- [ ] **Step 8: Lint, tipos y build**

Run: `npm run lint && npx tsc --noEmit`
Expected: sin errores. Si `tsc` se queja de que falta `isLevelChampionship` en algún literal de `EventFormData`, ese es el sitio del Step 7.

- [ ] **Step 9: Probar a mano**

Run: `npm run dev`, entrar a `/admin/eventos`, «Nuevo evento».

Verificar:
1. Con disciplina «Natación Artística» aparece la casilla «Es un campeonato de niveles». Con Clavados y Polo, no.
2. Al marcarla aparecen las tres secciones con las categorías de las bases y los años de la temporada elegida.
3. Cambiar la temporada recalcula los años.
4. «Agregar categoría» agrega una fila vacía en el nivel correcto; el tacho la borra.
5. Crear el evento genera las pruebas con la etiqueta `Básico — Infantil A — Damas` y ordenadas básico → intermedio → avanzado.

- [ ] **Step 10: Commit**

```bash
git add src/app/admin/eventos/event-form-dialog.tsx src/app/admin/eventos/\[id\]/page.tsx
git commit -m "Agrega la casilla y las secciones por nivel al formulario de eventos"
```

---

### Task 7: Nivel en el generador masivo

Un evento existente marcado como campeonato de niveles necesita poder asignarle nivel a las pruebas que genere después.

**Files:**
- Modify: `src/app/admin/eventos/actions.ts` (`bulkSchema`, `bulkGenerateModalities`)
- Modify: `src/app/admin/eventos/[id]/modalities-manager.tsx`
- Modify: `src/app/admin/eventos/[id]/page.tsx` (pasar `isLevelChampionship` al manager)

**Interfaces:**
- Consumes: `ARTISTIC_LEVEL_VALUES`, `ARTISTIC_LEVEL_LABELS`, `isArtisticLevel` (Task 1).
- Produces: el campo de formulario `level` del generador masivo.

- [ ] **Step 1: Extender `bulkSchema`**

En `src/app/admin/eventos/actions.ts`, dentro de `bulkSchema`, después de `allowsCategoryUpgrade`:

```ts
  level: z.string().optional(),
```

En el `safeParse` de `bulkGenerateModalities`:

```ts
    level: String(formData.get("level") ?? ""),
```

- [ ] **Step 2: Validar y aplicar el nivel**

Después de la guarda de `allowsCategoryUpgrade`:

```ts
  const level = parsed.data.level?.trim() ? parsed.data.level.trim() : null
  if (level !== null) {
    if (!isArtisticLevel(level)) {
      return { success: false, error: "Nivel inválido." }
    }
    if (parsed.data.discipline !== "ARTISTIC_SWIMMING") {
      return {
        success: false,
        error: "El nivel solo aplica a natación artística.",
      }
    }
    if (!event.isLevelChampionship) {
      return {
        success: false,
        error: "Este evento no es un campeonato de niveles.",
      }
    }
  }
```

Ojo: esa guarda usa `event`, así que va **después** del `findUnique` que lo carga.

En el `.map()` que arma `rows`, agregar el nivel y anteponerlo a la etiqueta:

```ts
  }).map((row) => ({
    ...row,
    eventId: event.id,
    ...leagueFields,
    level,
    // Igual que al crear el evento: el nivel viaja también dentro de `category`
    // para que la descripción de la orden distinga dos pruebas homónimas.
    category:
      level === null
        ? row.category
        : [ARTISTIC_LEVEL_LABELS[level], row.category].filter(Boolean).join(" — "),
  }))
```

Agregar al import de `@/lib/artistic-levels`:

```ts
import {
  ARTISTIC_LEVEL_LABELS,
  isArtisticLevel,
  levelCategoriesToSpecs,
  parseLevelCategories,
} from "@/lib/artistic-levels"
```

- [ ] **Step 3: El selector en el generador**

En `src/app/admin/eventos/[id]/modalities-manager.tsx`:

1. Agregar `isLevelChampionship: boolean` a las props del componente que hoy recibe `isLeague` (alrededor de la línea 148-156), y aceptarlo en la desestructuración.
2. En el formulario del generador masivo, justo antes del bloque de «Sexos a generar», agregar:

```tsx
          {isLevelChampionship && bulkDiscipline === "ARTISTIC_SWIMMING" ? (
            <div>
              <Label htmlFor="bulk-level">Nivel</Label>
              <Select id="bulk-level" name="level" defaultValue="">
                <option value="">Sin nivel</option>
                {ARTISTIC_LEVEL_VALUES.map((level) => (
                  <option key={level} value={level}>
                    {ARTISTIC_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs leading-5 text-fdnda-muted">
                El nombre del nivel se antepone a la categoría de cada prueba
                generada.
              </p>
            </div>
          ) : null}
```

3. Agregar el import:

```tsx
import {
  ARTISTIC_LEVEL_LABELS,
  ARTISTIC_LEVEL_VALUES,
} from "@/lib/artistic-levels"
```

Verificá que `Select` ya esté importado desde `@/components/ui/input` en ese archivo; si no, agregalo.

- [ ] **Step 4: Pasar la prop desde la página**

En `src/app/admin/eventos/[id]/page.tsx`, donde se renderiza el manager y ya se le pasa `isLeague={event.isLeague}`, agregar:

```tsx
        isLevelChampionship={event.isLevelChampionship}
```

- [ ] **Step 5: Lint y tipos**

Run: `npm run lint && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Probar a mano**

Run: `npm run dev`. Abrir un evento de artística marcado como campeonato de niveles, generador masivo: aparece «Nivel». Generar con «Intermedio» produce pruebas con `category` que empieza en «Intermedio — ». En un evento de artística **sin** la marca, el selector no aparece.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/eventos/actions.ts src/app/admin/eventos/\[id\]/modalities-manager.tsx src/app/admin/eventos/\[id\]/page.tsx
git commit -m "Permite asignar nivel desde el generador masivo"
```

---

### Task 8: El nivel a la vista

**Files:**
- Modify: `src/app/(portal)/inscripciones/types.ts` (`ModalityView`)
- Modify: `src/app/(portal)/inscripciones/[planId]/page.tsx` (mapear `level`)
- Modify: `src/app/(portal)/inscripciones/[planId]/athlete-board.tsx` (agrupar)
- Modify: `src/app/admin/eventos/[id]/modalities-manager.tsx` (badge de nivel)

**Interfaces:**
- Consumes: `EventModality.level` (Task 2), `ARTISTIC_LEVEL_LABELS` y `ARTISTIC_LEVEL_VALUES` (Task 1).
- Produces: `ModalityView.level: string | null`.

- [ ] **Step 1: Agregar `level` a `ModalityView`**

En `src/app/(portal)/inscripciones/types.ts`, dentro de `interface ModalityView`, después de `category`:

```ts
  /** Nivel del campeonato de niveles de artística. null fuera de ese formato. */
  level: string | null
```

- [ ] **Step 2: Mapearlo**

En `src/app/(portal)/inscripciones/[planId]/page.tsx`, dentro del `modalities.map(...)` que arma `modalityViews`, después de `category: modality.category,`:

```ts
      level: modality.level,
```

- [ ] **Step 3: Agrupar en el tablero del club**

En `src/app/(portal)/inscripciones/[planId]/athlete-board.tsx`, después de `const teamModalities = ...`:

```ts
  // Un campeonato de niveles triplica la lista de pruebas. Agruparlas por nivel
  // es lo que evita que el delegado tenga que leer el prefijo de cada etiqueta
  // para saber en cuál está parado.
  // Grupos en el orden en que compiten, y al final las pruebas sin nivel (todo
  // lo que no es un campeonato de niveles). Un evento normal produce un solo
  // grupo sin encabezado, así que la pantalla de hoy no cambia.
  function groupByLevel(rows: ModalityView[]) {
    const groups: Array<{ level: string | null; rows: ModalityView[] }> = []
    for (const level of ARTISTIC_LEVEL_VALUES) {
      const matching = rows.filter((row) => row.level === level)
      if (matching.length > 0) groups.push({ level, rows: matching })
    }
    const sinNivel = rows.filter((row) => row.level === null)
    if (sinNivel.length > 0) groups.push({ level: null, rows: sinNivel })
    return groups
  }
```

Donde hoy se recorre `individualModalities` (y lo mismo para `teamModalities`), envolver el recorrido en los grupos:

```tsx
        {groupByLevel(individualModalities).map((group) => (
          <div key={group.level ?? "sin-nivel"} className="space-y-2">
            {group.level ? (
              <h3 className="text-xs font-bold uppercase tracking-wide text-fdnda-turquoise-deep">
                {ARTISTIC_LEVEL_LABELS[
                  group.level as keyof typeof ARTISTIC_LEVEL_LABELS
                ]}
              </h3>
            ) : null}
            {/* … acá va el mismo recorrido de pruebas que ya existe,
                cambiando `individualModalities.map` por `group.rows.map` … */}
          </div>
        ))}
```

Import:

```ts
import {
  ARTISTIC_LEVEL_LABELS,
  ARTISTIC_LEVEL_VALUES,
} from "@/lib/artistic-levels"
```

- [ ] **Step 4: Badge en el gestor de pruebas**

En `src/app/admin/eventos/[id]/modalities-manager.tsx`:

1. Agregar `level: string | null` al tipo de fila (el que empieza en la línea 40).
2. En el `TableCard` del listado (alrededor de la línea 248), agregar el nivel a los badges:

```tsx
              badges={
                <>
                  {m.level ? (
                    <Badge variant="neutral">
                      {ARTISTIC_LEVEL_LABELS[
                        m.level as keyof typeof ARTISTIC_LEVEL_LABELS
                      ]}
                    </Badge>
                  ) : null}
                  <Badge variant={m.isActive ? "success" : "neutral"}>
                    {m.isActive ? "Activa" : "Inactiva"}
                  </Badge>
                </>
              }
```

3. En `src/app/admin/eventos/[id]/page.tsx`, agregar `level: m.level,` donde se arma cada fila del listado de pruebas.

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Lint, tipos y build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: sin errores.

- [ ] **Step 7: Probar a mano el circuito completo**

Run: `npm run dev`.

1. Crear un evento de artística marcado como campeonato de niveles, con las tres tablas precargadas y dos pruebas (Solo Libre, Dueto Libre).
2. Verificar en `/admin/eventos/<id>` que las pruebas salen con badge de nivel y ordenadas básico → intermedio → avanzado.
3. Abrir el evento, entrar como club y armar una planilla: las pruebas aparecen agrupadas por nivel.
4. Verificar que un nadador nacido en el año extra masculino de Juvenil aparece elegible en la prueba de varones y **no** en la de damas.
5. Llegar al resumen y confirmar que la descripción de cada línea incluye el nivel.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(portal\)/inscripciones src/app/admin/eventos
git commit -m "Muestra el nivel en el gestor de pruebas y en la planilla"
```

---

### Task 9: Documentar el formato

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Agregar la sección**

En `README.md`, después de la sección que describe los eventos de liga, agregar:

```markdown
## Campeonato de niveles (natación artística)

Un evento de artística puede marcarse como **campeonato de niveles**: básico,
intermedio y avanzado compiten el mismo día con categorías por edad propias.

- `Event.isLevelChampionship` es la bandera, gemela de `isLeague`.
- `EventModality.level` guarda el nivel de cada prueba. Un CHECK lo limita a
  artística.
- El nivel viaja **además** dentro de `category` («Básico — Infantil A —
  Damas»). Sin eso, la descripción de la orden —que se arma con
  `disciplina — nombre — category`— mostraría dos líneas idénticas para la
  misma prueba de dos niveles distintos.
- Las tablas de categorías de las bases viven en `src/lib/artistic-levels.ts`.
  Se guardan como **edades** y se convierten a años con
  `birthYearFrom = seasonYear - edad`, porque las bases miden al 31 de
  diciembre. No uses `birthYearForMaxAge`: ese `+1` es del «Sub-N» de polo.
- Juvenil y Junior admiten un año más en varones. Lo lleva
  `CategorySpec.maleBirthYearFrom`, que `buildModalityRows` aplica a las
  variantes MALE, MIXED y ANY.

Las categorías precargadas son un punto de partida editable: si la federación
cambia las bases, el admin corrige en el formulario sin esperar un despliegue.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Documenta el campeonato de niveles de artistica"
```

---

## Verificación final

- [ ] `npm run check` (lint + tsc + prisma validate + test + build) pasa entero.
- [ ] Un evento de clavados y uno de polo se crean exactamente como antes: sin casilla de niveles, sin columna `level`.
- [ ] Un evento de artística **sin** la casilla se crea como antes.
- [ ] `git log --oneline` muestra un commit por tarea.
