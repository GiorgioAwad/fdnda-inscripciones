# Polo, dos conceptos de cobro: lo que queda pendiente

Cierre del plan `2026-08-12-polo-dos-conceptos-de-cobro.md`, implementado en la
rama `rediseno-andarivel` entre `bc4b54a` y `1029626` (22 commits).

Las ocho tareas del plan están hechas, revisadas y con la revisión final de rama
cerrada. Esto es lo que quedó anotado y **no** se hizo, para que no se pierda.

---

## 1. Bloqueante para la release siguiente: retirar `pricingMode`

La Tarea 9 del plan original quedó fuera a propósito. Vercel corre las
migraciones durante el build, así que hay una ventana en la que instancias con
el código viejo hablan con el esquema nuevo; borrar la columna junto con el
resto las habría tumbado.

**Antes de borrarla, en el mismo commit:**

- Quitar la doble escritura de `pricingMode` en `saveEvent`
  (`src/app/admin/eventos/actions.ts`). Está marcada con un comentario que dice
  cuándo se borra.
- Actualizar el comentario de cabecera de `model EventDisciplineConfig` en
  `prisma/schema.prisma`: hoy explica la regla en términos de `pricingMode` y va
  a citar un campo inexistente.
- Actualizar el párrafo del README que documenta la supervivencia de la columna.
- Corregir el comentario de `src/lib/registration-snapshots.ts` que menciona
  "pricingMode PER_ATHLETE".
- Corregir el título del test de `src/lib/event-pricing.test.ts` que todavía
  dice "PER_ATHLETE".

**Ojo con el CHECK.** `DROP COLUMN "pricingMode"` en Postgres se lleva en
silencio cualquier restricción que dependa de esa columna. El CHECK vigente ya
no depende de ella (se reemplazó en
`20260814120000_check_cuota_por_concepto`), pero verificalo antes de borrar, no
después.

---

## 2. La brecha de tests, en orden de retorno

No existe arnés de tests para server actions ni para componentes. Durante esta
rama aparecieron ahí tres defectos reales —un hueco de autorización, una
pantalla que le afirmaba al club un cobro que no se le hacía, y una nota
congelada que contradecía el importe— y **los tres los encontró la revisión, no
los tests**.

La revisión final opinó, y coincido: no bloquea este merge, pero debería
bloquear el próximo cambio que toque dinero en una server action.

1. **Arnés de server actions, primero.** Es lo barato y es donde estuvo el hueco
   de autorización. Son funciones async normales;
   `src/lib/registration-plans.test.ts` ya demuestra el patrón con `vi.hoisted`
   + `vi.mock("./prisma")`. Faltan mocks de `requireClubUser` y
   `revalidatePath`. Con eso se fija, por acción: que valida la entrada, que
   llama al assert de acceso, y que delega con el `clubId` de la sesión y no con
   el del cliente.
2. **Seguir empujando lógica a funciones puras** en vez de testear componentes.
   El Critical de la revisión final se habría caído solo si la decisión efectiva
   hubiera vivido en una función pura con tests, en lugar de recalcularse en
   cuatro lugares.
3. **Arnés de React: último, y quizá nunca.** Es el más caro y el que menos
   defectos por hora encuentra en esta base.

**Un test concreto que falta ya:** ninguna prueba ejercita
`checkoutRegistrationPlan` como llamador. La nota de cobro que congela en cada
`OrderItem` está cubierta solo en su función pura extraída; el cableado —la
alineación de claves del mapa de disciplinas y los defaults— se verificó a mano.
Es la misma clase de hueco que dejó pasar la regresión que hubo que arreglar
después.

---

## 3. Deuda menor, sin urgencia

- `src/lib/event-report.ts:289-300` (`normalizeLiveRegistration`) cotiza
  registros sin snapshot leyendo `chargesEntry` crudo, sin cruzar nunca la
  elección del club. Hoy es inalcanzable con datos nuevos —toda inscripción
  nueva lleva snapshot— pero si algún snapshot no parsea, reconstruiría un
  plantel de polo a precio de lista aunque el club no lo haya pagado.
- La cabecera de `/admin/eventos/[id]` dejó de mostrar el monto exacto de la
  cuota en línea. El dato sigue en el diálogo de edición y en el reporte.
- `entryChargeNoteFromDescription` (`src/lib/entry-charge-note.ts`) lee la nota
  releyendo el sufijo congelado en `OrderItem.description`. La frase está
  protegida por tests, pero la **posición** no: quien decide que el sufijo va
  último es `buildRegistrationDescription`, en otro archivo. Si alguien agrega
  algo después del sufijo, todas las notas caen a `CHARGED` en silencio. Un test
  de ida y vuelta entre las dos funciones lo cerraría.
- `EntryChargeNote` y compañía se pueden importar desde `@/lib/entry-charge-note`
  o desde `@/lib/registration-plans`, que los reexporta. Nada impide que un
  módulo puro futuro los tome del segundo y vuelva a arrastrar Prisma, que es
  justo el problema que motivó separarlos.
- La migración del CHECK usa `DROP CONSTRAINT` sin `IF EXISTS`. Si algún entorno
  fue baselineado sin la restricción de agosto, el deploy falla ruidosamente.
  Riesgo bajo y falla visible, pero es un minuto arreglarlo.

---

## 4. Los otros tres planes del spec

El spec `docs/superpowers/specs/2026-08-12-polo-cobros-y-liga-design.md` se
partió en cuatro planes. Ya se ejecutaron el cobro por conceptos y los eventos
de liga. Quedan:

- `2026-08-12-polo-sin-reserva-y-plantel-de-14.md` — quitar la reserva en polo y
  subir el plantel a 14.
- `2026-08-12-filtros-de-nomina.md` — los filtros de la nómina.

Ninguno depende del otro.
