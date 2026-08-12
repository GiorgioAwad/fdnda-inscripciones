# Polo sin reserva y plantel de 14 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En polo, todos los seleccionados de un plantel son titulares —la reserva desaparece— y el plantel admite de 7 a 14 jugadores en vez de 7 a 13.

**Architecture:** `isReserve` se queda en el esquema porque natación artística lo usa de verdad en el Equipo Libre de 4 a 8. Lo que cambia es que en polo la UI no ofrece el botón **y** el servidor ignora `reserveIds`: esconder el botón solo no alcanza, porque guardar es una server action y una pestaña vieja seguiría marcando reservas. Como todos los renderizadores de "(reserva)" leen `isReserve` del dato guardado o del snapshot congelado, no hay que tocar ni el comprobante ni la planilla imprimible: dejan de imprimirlo solos.

**Tech Stack:** Next.js (App Router, server actions), Prisma 7 + PostgreSQL (Neon), Vitest, tsx para scripts.

## Global Constraints

- **Los snapshots congelados (`OrderItem.registrationSnapshot`) no se tocan nunca.** Son la evidencia de lo que se cobró; reescribirlos sería falsificar un comprobante.
- **Los eventos cerrados se quedan en 13.** Es la regla con la que se validó y se cobró una planilla real.
- El cambio de reserva es **solo para polo**. Artística conserva su botón.
- La condición para esconder el botón es **la disciplina**, no `maxAthletes > minAthletes`: en polo esa comparación siempre es cierta (7 ≠ 14).
- Comentarios y mensajes de usuario en español. Los mensajes de commit del repo van sin tildes.
- Correr `npm test` tras cada tarea.

---

## File Structure

**Se modifican:**
- `src/lib/event-presets.ts:99-100` — el plantel pasa a 7–14
- `src/lib/registration-plans.ts:781-973` — `saveRegistrationPlanEntry` ignora reservas en polo
- `src/app/(portal)/inscripciones/[planId]/team-formation-panel.tsx:12-14,117-125,166-178,245-261` — sin botón de reserva en polo
- `package.json` — un script npm más

**Se crean:**
- `scripts/normalizar-polo.ts` — sube el tope a 14 y borra las reservas de polo ya guardadas

---

### Task 1: El plantel admite 14

**Files:**
- Modify: `src/lib/event-presets.ts:96-102`
- Test: `src/lib/eligibility.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `DISCIPLINE_PRESETS.WATER_POLO.modalities[0]` con `minAthletes: 7, maxAthletes: 14`

- [ ] **Step 1: Escribir los tests que fallan**

En `src/lib/eligibility.test.ts` agregar:

```ts
import { DISCIPLINE_PRESETS } from "./event-presets"

describe("plantel de polo", () => {
  const plantel = {
    sexRule: "MALE" as const,
    birthYearFrom: null,
    birthYearTo: null,
    upgradeYear: null,
    minAthletes: DISCIPLINE_PRESETS.WATER_POLO.modalities[0].minAthletes,
    maxAthletes: DISCIPLINE_PRESETS.WATER_POLO.modalities[0].maxAthletes,
  }

  const jugadores = (cuantos: number) =>
    Array.from({ length: cuantos }, (_, i) => ({
      id: `a${i}`,
      sex: "M" as const,
      birthDate: new Date(Date.UTC(2012, 0, 1)),
    }))

  it("el preset admite de 7 a 14", () => {
    expect(plantel.minAthletes).toBe(7)
    expect(plantel.maxAthletes).toBe(14)
  })

  it("un plantel de 14 es válido", () => {
    expect(validateEntryComposition(plantel, jugadores(14))).toEqual([])
  })

  it("un plantel de 15 no cabe", () => {
    expect(validateEntryComposition(plantel, jugadores(15))).toHaveLength(1)
  })

  it("un plantel de 6 es demasiado chico", () => {
    expect(validateEntryComposition(plantel, jugadores(6))).toHaveLength(1)
  })
})
```

Ajustar la forma de `jugadores` a la que ya use `eligibility.test.ts` para sus deportistas (mismo tipo `EligibilityAthlete`).

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run src/lib/eligibility.test.ts`
Expected: FAIL — `maxAthletes` es 13 y el plantel de 14 devuelve un error de composición.

- [ ] **Step 3: Cambiar el preset**

En `src/lib/event-presets.ts`, en la entrada `WATER_POLO`:

```ts
      {
        name: "Plantel",
        sexRules: ["FEMALE", "MALE"],
        minAthletes: 7,
        maxAthletes: 14,
      },
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run src/lib/eligibility.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-presets.ts src/lib/eligibility.test.ts
git commit -m "El plantel de polo admite 14 jugadores, no 13"
```

---

### Task 2: El servidor ignora las reservas en polo

**Files:**
- Modify: `src/lib/registration-plans.ts:781-808` (normalización de entrada), `:823-837` (consulta de la prueba), `:932-942` (creación de filas)
- Test: `src/lib/registration-plans.test.ts:169-280`

**Interfaces:**
- Consumes: nada
- Produces: `saveRegistrationPlanEntry` sigue aceptando `reserveIds` en su input, pero los descarta cuando la prueba es de `WATER_POLO`

- [ ] **Step 1: Escribir el test que falla**

El ayudante `editablePlan()` del `describe("guardar formaciones y reservas")` (`src/lib/registration-plans.test.ts:170-192`) hoy devuelve `{ id: "modality-1" }` en `eventModality.findFirst`. Cambiarlo para que también devuelva la disciplina, que es el dato nuevo que la función va a leer:

```ts
    database.tx.eventModality.findFirst.mockResolvedValue({
      id: "modality-1",
      discipline: "ARTISTIC_SWIMMING",
    })
```

Así el test existente `"deduplica integrantes y solo marca reservas que pertenecen a la formación"` (`:194`) sigue pasando sin tocarlo: artística conserva la reserva.

Y agregar al mismo `describe`:

```ts
  it("en polo descarta las reservas: todos los seleccionados son titulares", async () => {
    editablePlan()
    database.tx.eventModality.findFirst.mockResolvedValue({
      id: "modality-1",
      discipline: "WATER_POLO",
    })

    const result = await saveRegistrationPlanEntry({
      planId: "plan-1",
      clubId: "club-1",
      expectedRevision: 4,
      entry: {
        modalityId: "modality-1",
        athleteIds: ["athlete-1", "athlete-2"],
        reserveIds: ["athlete-2"],
      },
    })

    expect(result).toMatchObject({ success: true })
    const createdRegistration = database.tx.registration.create.mock.calls[0][0]
    const registrationId = createdRegistration.data.id as string
    expect(database.tx.registrationAthlete.createMany).toHaveBeenCalledWith({
      data: [
        {
          registrationId,
          modalityId: "modality-1",
          athleteId: "athlete-1",
          isReserve: false,
        },
        {
          registrationId,
          modalityId: "modality-1",
          athleteId: "athlete-2",
          isReserve: false,
        },
      ],
    })
  })
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/registration-plans.test.ts`
Expected: FAIL — en polo, `athlete-2` se guarda con `isReserve: true`.

- [ ] **Step 3: Traer la disciplina de la prueba**

En `saveRegistrationPlanEntry`, cambiar el `select` de la consulta de la prueba:

```ts
      const modality = await tx.eventModality.findFirst({
        where: {
          id: input.entry.modalityId,
          eventId: plan.eventId,
          isActive: true,
        },
        select: { id: true, discipline: true },
      })
```

- [ ] **Step 4: Descartar las reservas en polo al crear las filas**

Reemplazar el bloque que crea `registrationAthlete`:

```ts
      if (athleteIds.length > 0) {
        // En polo no hay reserva: los 14 del plantel son titulares. Se descarta
        // acá y no solo en la UI porque guardar es una server action, y una
        // pestaña sin recargar seguiria mandando reserveIds.
        const reserves =
          modality.discipline === "WATER_POLO" ? new Set<string>() : new Set(reserveIds)
        await tx.registrationAthlete.createMany({
          data: athleteIds.map((athleteId) => ({
            registrationId: registrationId!,
            modalityId: modality.id,
            athleteId,
            isReserve: reserves.has(athleteId),
          })),
        })
      }
```

Actualizar el comentario de cabecera de la función si menciona reservas.

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/registration-plans.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/registration-plans.ts src/lib/registration-plans.test.ts
git commit -m "El servidor descarta las reservas de polo, no solo la interfaz"
```

---

### Task 3: El botón de reserva desaparece en polo

**Files:**
- Modify: `src/app/(portal)/inscripciones/[planId]/team-formation-panel.tsx:12-14,97-125,166-178,245-261`

**Interfaces:**
- Consumes: `ModalityView.discipline` (ya existe)
- Produces: nada que consuman otras tareas

- [ ] **Step 1: Calcular si la prueba admite reservas**

Debajo de `const modality = ...` (línea 75), agregar:

```tsx
  // En polo todos los seleccionados son titulares. La condición es la
  // DISCIPLINA y no `maxAthletes > minAthletes`: en un plantel de 7 a 14 esa
  // comparación siempre es cierta y el botón volvería a aparecer.
  const admiteReservas =
    modality.discipline !== "WATER_POLO" &&
    modality.maxAthletes > modality.minAthletes
```

- [ ] **Step 2: Esconder el botón**

Cambiar la condición del botón (línea 245) de `checked && modality.maxAthletes > modality.minAthletes` a:

```tsx
                    {checked && admiteReservas ? (
```

- [ ] **Step 3: No escribir "(reserva)" en la lista de formaciones**

En el resumen de cada formación (línea ~174), cambiar:

```tsx
                    return athlete
                      ? `${athleteName(athlete)}${
                          admiteReservas && entry.reserveIds.includes(id)
                            ? " (reserva)"
                            : ""
                        }`
                      : "Deportista"
```

- [ ] **Step 4: Actualizar el comentario de cabecera**

El comentario del archivo (líneas 12-14) dice "y marcar quién va de reserva". Cambiarlo a:

```tsx
// Editor de formaciones de equipo (dueto, equipo artístico, plantel de polo).
// Es lo único que no cabe en la vista por deportista: hay que elegir a varios y
// respetar el tamaño de la formación. En artística además se marca quién va de
// reserva; en polo no hay reserva y todos los seleccionados son titulares.
```

- [ ] **Step 5: Verificar en el navegador**

Run: `npm run dev`, abrir una planilla con una prueba de polo y otra de artística (Equipo Libre).
Expected: en el plantel de polo no aparece el botón "¿Reserva?" y la lista de la formación no dice "(reserva)"; en el equipo de artística sigue apareciendo y funcionando.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(portal)/inscripciones/[planId]/team-formation-panel.tsx"
git commit -m "Sin boton de reserva en los planteles de polo"
```

---

### Task 4: Script para los datos que ya existen

**Files:**
- Create: `scripts/normalizar-polo.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nada del código de la app (el script habla directo con Prisma, como los demás de `scripts/`)
- Produces: un script idempotente `npm run db:normalizar-polo [-- --dry-run]`

- [ ] **Step 1: Escribir el script**

Crear `scripts/normalizar-polo.ts`:

```ts
import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

// Normaliza los datos de polo que quedaron de antes de dos decisiones:
//
//   1. El plantel admite 14 jugadores, no 13. Se corrige en los eventos que
//      todavia se pueden editar (DRAFT y OPEN). Los CLOSED se quedan en 13: es
//      la regla con la que se valido y se cobro una planilla real, y cambiarla
//      haria mentir al historial.
//   2. En polo no hay reserva. Las filas ya guardadas con isReserve pasan a
//      titulares. Los snapshots congelados de las ordenes NO se tocan: son la
//      evidencia de lo que se cobro.
//
// Es idempotente: correrlo dos veces no cambia nada la segunda.
//
//   npx tsx scripts/normalizar-polo.ts [--dry-run]

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

const dryRun = process.argv.includes("--dry-run")

async function main() {
  const planteles = await prisma.eventModality.findMany({
    where: {
      discipline: "WATER_POLO",
      maxAthletes: 13,
      event: { status: { in: ["DRAFT", "OPEN"] } },
    },
    select: { id: true, name: true, category: true, event: { select: { name: true } } },
  })

  console.log(`Planteles a subir de 13 a 14: ${planteles.length}`)
  for (const row of planteles) {
    console.log(`  · ${row.event.name} — ${row.name} ${row.category ?? ""}`)
  }
  if (!dryRun && planteles.length > 0) {
    await prisma.eventModality.updateMany({
      where: { id: { in: planteles.map((row) => row.id) } },
      data: { maxAthletes: 14 },
    })
  }

  const reservas = await prisma.registrationAthlete.count({
    where: { isReserve: true, registration: { modality: { discipline: "WATER_POLO" } } },
  })

  console.log(`Reservas de polo a convertir en titulares: ${reservas}`)
  if (!dryRun && reservas > 0) {
    await prisma.registrationAthlete.updateMany({
      where: {
        isReserve: true,
        registration: { modality: { discipline: "WATER_POLO" } },
      },
      data: { isReserve: false },
    })
  }

  console.log(dryRun ? "Dry run: no se escribio nada." : "Listo.")
}

void main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
```

- [ ] **Step 2: Registrar el script en package.json**

En `"scripts"`, junto a los otros `db:`:

```json
    "db:normalizar-polo": "tsx scripts/normalizar-polo.ts",
```

- [ ] **Step 3: Correr en seco contra la base local**

Run: `npm run db:normalizar-polo -- --dry-run`
Expected: imprime los conteos y "Dry run: no se escribio nada."; no cambia ninguna fila.

- [ ] **Step 4: Correr de verdad y verificar idempotencia**

Run: `npm run db:normalizar-polo && npm run db:normalizar-polo -- --dry-run`
Expected: la segunda corrida reporta `0` y `0`.

- [ ] **Step 5: Verificar que un evento cerrado quedó intacto**

Run: `npx prisma studio` y buscar un `EventModality` de polo de un evento `CLOSED`.
Expected: sigue en `maxAthletes = 13`.

- [ ] **Step 6: Correr todo**

Run: `npm run check`
Expected: lint, tipos, `prisma validate`, tests y build en verde.

- [ ] **Step 7: Commit**

```bash
git add scripts/normalizar-polo.ts package.json
git commit -m "Script: sube el plantel a 14 y convierte las reservas de polo en titulares"
```
