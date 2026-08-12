# Polo: dos conceptos de cobro, sin reserva, y eventos de liga

Fecha: 2026-08-12
Estado: aprobado, pendiente de plan de implementación

## Por qué

Polo acuático dejó de caber en el modelo de cobro del sistema. Un evento de polo
necesita cobrar dos cosas a la vez —la inscripción del plantel y una cuota por
jugador— y el club decide cuáles de las dos paga. Además aparece un tipo de
evento nuevo, la liga, donde el precio del plantel no es un número suelto sino el
producto de los partidos que ese equipo va a jugar.

En el camino se corrigen tres cosas más que hoy estorban en polo: la reserva (que
en polo no significa nada), el tope de 13 jugadores (son 14) y la falta de
filtros para saber a quién ya inscribiste y a quién te falta.

## Qué existe hoy

`EventDisciplineConfig.pricingMode` es un interruptor de dos posiciones:

- `PER_ENTRY` — cobra una vez por formación; el precio vive en `EventModality.price`.
- `PER_ATHLETE` — cobra una cuota fija por deportista para todo el evento; las
  pruebas se crean con precio 0 a propósito y el cobro se materializa en
  `EventAthleteFee`.

Todo el motor de precios (`lib/event-pricing.ts`), la validación
(`lib/plan-validation.ts`), los snapshots y los reportes descansan en que esos
dos modos son excluyentes. Y sobre una regla que sostiene el rollout entero:

> **Ausencia de fila `EventDisciplineConfig` = `PER_ENTRY` + `RANGE`.**
> Ningún evento anterior a esa tabla cambia de precio ni de elegibilidad.

Esa regla se conserva intacta en este diseño.

## Decisiones tomadas

| Pregunta | Decisión |
|---|---|
| ¿Quién elige la forma de pago en polo? | El club, al inscribirse |
| ¿Cómo se combinan los dos cobros? | Se suman sobre el mismo plantel |
| ¿Qué elige exactamente el club? | Qué conceptos paga: el plantel, la cuota, o los dos |
| ¿Cómo se cobra la fase preliminar de la liga? | Precio por partido × los partidos que juega su equipo |
| ¿De dónde salen los partidos? | Los escribe el admin por categoría |
| ¿Cómo se modela el doble cobro? | Dos banderas independientes, se retira `pricingMode` |

---

## 1 · Cómo cobra un evento de polo

### Modelo

`EventDisciplineConfig` reemplaza `pricingMode` por dos banderas independientes:

| campo | significado | default |
|---|---|---|
| `chargesEntry` | cobra por formación; el precio sigue en `EventModality.price` | `true` |
| `chargesAthleteFee` | cobra una cuota por jugador; el monto en `athleteFee` (ya existe) | `false` |

Los defaults son exactamente el comportamiento histórico, así que la regla de
"fila ausente = cobra por formación" sigue valiendo palabra por palabra.

Las dos banderas pueden estar prendidas al mismo tiempo. Ahí es donde vive polo.

### Quién elige, sin agregar un interruptor más

No hace falta un campo del tipo "el club puede elegir". La elección **aparece
sola** cuando el evento tiene los dos conceptos prendidos:

- Clavados (solo cuota) y natación artística (solo formación) no ofrecen nada
  que elegir, y por lo tanto nadie puede optar por no pagar.
- Polo, con los dos, sí.

La respuesta del club vive en `RegistrationPlan`:

| campo | tipo | significado |
|---|---|---|
| `paysEntry` | `Boolean?` | `null` = lo que diga el evento |
| `paysAthleteFee` | `Boolean?` | `null` = lo que diga el evento |

Anulables a propósito: las planillas ya existentes y las de otras disciplinas no
se enteran del cambio.

La elección es **una por planilla**, no una por plantel: la planilla ya está
acotada a un evento y a una disciplina, así que ahí es donde la decisión tiene
sentido. Un club que quiera pagar el sub 15 de una manera y el open de otra hace
dos planillas.

**Regla dura:** si el evento habilita los dos conceptos, la planilla debe marcar
al menos uno. Marcar ninguno bloquea el pago con un error de validación, igual
que hoy lo bloquea una formación incompleta.

### Motor de precios

En `computePlanPricing` (`lib/event-pricing.ts`) la única regla nueva es:

```
cobra la formación  si  chargesEntry      && (paysEntry      ?? true)
cobra la cuota      si  chargesAthleteFee && (paysAthleteFee ?? true)
```

Las dos condiciones pueden ser ciertas a la vez, y entonces los montos se suman.

Todo lo demás sobrevive sin cambios:

- La línea `ENTRY` de cada formación se sigue emitiendo **aunque valga 0**. Es el
  registro nominal congelado del que viven los reportes y la constancia. Cuando
  vale 0 porque el club no marcó ese concepto, la descripción lo dice.
- Las cuotas ya cubiertas por otra orden del mismo evento se siguen descontando.
- El único `(eventId, discipline, athleteId)` de `EventAthleteFee` sigue siendo
  la garantía de base de que a un jugador no se le cobra dos veces la cuota.
- `EventAthleteFee` se sigue materializando solo en el checkout, nunca durante la
  edición de la planilla.

### Validación

- Nuevo error: el evento habilita los dos conceptos y la planilla no marcó
  ninguno.
- El aviso actual de "disciplina `PER_ATHLETE` sin cuota positiva" pasa a ser
  "concepto habilitado sin precio", y ahora aplica a los dos conceptos.

### Admin

En el formulario de evento, el desplegable "Cómo se cobra" pasa a dos casillas
con su precio al lado. Los presets por disciplina quedan así:

| disciplina | formación | cuota por deportista |
|---|---|---|
| Clavados | no | sí |
| Natación artística | sí | no |
| Polo acuático | sí | sí |

Se termina la regla de "en `PER_ATHLETE` las pruebas se crean con precio 0": un
plantel de polo tiene precio propio y además cuota.

### Migración, en dos pasos

Vercel corre las migraciones durante el build, así que hay una ventana en la que
instancias con el código viejo hablan con el esquema nuevo. Por eso:

1. **Release A** — agregar `chargesEntry` y `chargesAthleteFee`, rellenarlas
   desde `pricingMode`, y desplegar el código que ya lee las banderas nuevas.
   `pricingMode` queda en la base sin que nadie la lea.
2. **Release B** — borrar `pricingMode`.

```sql
-- Release A
ALTER TABLE "event_discipline_configs"
  ADD COLUMN "chargesEntry"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "chargesAthleteFee" BOOLEAN NOT NULL DEFAULT false;

UPDATE "event_discipline_configs" SET
  "chargesEntry"      = ("pricingMode" = 'PER_ENTRY'),
  "chargesAthleteFee" = ("pricingMode" = 'PER_ATHLETE');
```

---

## 2 · Eventos de liga

### La marca

`Event.isLeague Boolean @default(false)`, con una casilla en el formulario de
creación que **solo aparece cuando la disciplina es polo**.

### Las categorías

En un evento de liga cada prueba gana tres datos:

| campo | significado |
|---|---|
| `pricePerMatch` | lo que cuesta un partido |
| `matchesPerTeam` | cuántos partidos juega cada equipo en la fase preliminar |
| `expectedTeams` | cuántos equipos espera la categoría |

Los tres son anulables y solo se piden cuando el evento tiene `isLeague`. Una
prueba de polo fuera de una liga sigue teniendo su `price` escrito a mano, como
hoy.

Al guardar la prueba, el formulario multiplica y escribe
`price = pricePerMatch × matchesPerTeam`.

Esto es lo que hace que el motor de precios **no cambie nada** para la liga:
sigue cobrando "una formación a S/ 1 200" como siempre. Los tres campos nuevos
son la memoria del cálculo, y sirven para dos cosas: mostrarle al club el
desglose `4 partidos × S/ 300 = S/ 1 200` en vez de un número caído del cielo, y
calcular el fixture.

### El fixture

`partidos totales = expectedTeams × matchesPerTeam / 2`, redondeado hacia arriba.
Es informativo: se muestra en el admin y en la ficha del evento, no se cobra
desde ahí.

Con los números de la Liga de Lima 2026:

| categoría | equipos | partidos/equipo | total |
|---|---|---|---|
| Masculino Sub 15 | 4 | 4 | 8 |
| Masculino Open | 3 | 4 | 6 |
| Femenino Sub 15 | 3 | 4 | 6 |
| Femenino Open | 3 | 4 | 6 |

**Nada de Lima queda escrito en el código.** La Liga de Lima 2026 se carga como
un evento de polo con `isLeague`, cuatro categorías y sus números.

### Alcance

Solo la fase preliminar. Semifinales y finales quedan fuera de este trabajo. Si
después hay que cobrarlas, el modelo aguanta: otra prueba, otros partidos por
equipo.

---

## 3 · Quitar la reserva en polo

El botón "¿Reserva?" desaparece cuando la formación es de polo, y todos los
seleccionados se guardan como titulares.

`isReserve` **se queda en el esquema**: natación artística lo usa de verdad en el
Equipo Libre de 4 a 8.

Tres consecuencias que no son obvias:

1. Hoy el botón aparece cuando `maxAthletes > minAthletes`. En polo eso siempre
   se cumple (7 ≠ 14), así que la condición pasa a ser **la disciplina**, no el
   tamaño de la formación.
2. Esconder el botón no alcanza. Guardar es una server action, así que
   `saveRegistrationPlanEntry` tiene que **ignorar** `reserveIds` cuando la
   prueba es de polo. Sin eso, una pestaña vieja sigue marcando reservas.
3. La palabra "(reserva)" sale en tres lugares —la descripción del ítem de la
   orden, el resumen de pago y la planilla oficial imprimible—. En polo dejan de
   imprimirla.

**Datos viejos:** un `UPDATE` pone en falso las reservas de polo ya guardadas en
`registration_athletes`. Los snapshots congelados de órdenes pagadas **no se
tocan**: son la evidencia de lo que se cobró, y reescribirlos sería falsificar un
comprobante.

---

## 4 · Filtros al armar la planilla

En la pantalla del delegado, sobre la nómina, una fila de chips con su conteo.
Son de cliente: la nómina ya viaja completa a la página.

- **Todos**
- **Con pruebas**
- **Sin pruebas** — está en la planilla pero no marcó nada
- **En un plantel**

Más un selector de prueba que deja la nómina en quienes están inscritos en esa
prueba. Es el "¿quién tengo en el sub 15 masculino?".

"Quién falta seleccionar" tiene dos lecturas y se cubren las dos: el chip **Sin
pruebas** para los que ya están en la planilla, y un modo **Solo los que faltan
agregar** en el buscador de arriba para los deportistas del club que ni siquiera
fueron agregados.

Ese último es el único que toca el servidor: la lista de deportistas está
paginada, así que el filtro tiene que ser un parámetro de
`searchClubAthletesForPlan`, no un `filter` en memoria.

**Asunción:** los filtros van en la pantalla del delegado, no en el reporte del
admin.

---

## 5 · El tope de 14 jugadores

El preset de polo pasa de `7–13` a `7–14` en `lib/event-presets.ts`.

Eso solo alcanza a los eventos que se creen de ahora en adelante: los existentes
tienen su propio 13 guardado en cada `EventModality`. Un script sube a 14 los
planteles de polo de eventos en borrador o abiertos.

Los eventos ya cerrados se quedan en 13: es la regla con la que se validó y se
cobró una planilla real, y cambiarla haría mentir al historial.

---

## Orden sugerido

Las cinco piezas son independientes salvo por un detalle: la 1 y la 2 tocan el
mismo formulario de evento, y la 3 y la 5 tocan el mismo panel de formaciones.
Conviene no cruzarlas.

1. **Dos conceptos de cobro** (§1). Es la de mayor riesgo y la que arrastra
   migración en dos releases; va primero y sola.
2. **Liga** (§2). Encima del formulario ya modificado por la anterior.
3. **Reserva fuera de polo** (§3) y **tope de 14** (§5), juntas: son el mismo
   panel y el mismo script de datos viejos.
4. **Filtros** (§4). No depende de nada; puede ir en cualquier momento.

## Pruebas

Cada pieza cae en una suite que ya existe.

**Precios** (`lib/event-pricing.test.ts`)

- Los dos conceptos prendidos suman sobre el mismo plantel.
- El club que marca un solo concepto paga solo ese.
- No marcar ninguno da 0 y la validación falla.
- No-regresión, la que más importa: un evento **sin** fila de configuración sigue
  cobrando por formación.

**Migración** (`vitest.migration.config.mts`)

- Los eventos que hoy son `PER_ATHLETE` quedan con la cuota prendida y la
  formación apagada; los `PER_ENTRY`, al revés.

**Liga**

- `price = pricePerMatch × matchesPerTeam`.
- 4 equipos con 4 partidos cada uno dan 8 partidos totales; 3 equipos dan 6.

**Polo** (`lib/registration-plans.test.ts`, `lib/plan-validation.test.ts`)

- Guardar una formación de polo ignora `reserveIds`.
- Un plantel de 14 pasa; uno de 15 falla.

## Casos límite ya resueltos

- **Club cambia de conceptos con una orden viva:** no puede. Su planilla deja de
  ser editable en cuanto tiene orden (`status ≠ DRAFT`).
- **Admin apaga un concepto con planillas en borrador:** el precio se recalcula
  en la validación. Es lo mismo que ya pasa hoy al cambiar un precio.
- **Planilla suplementaria:** la cuota de un jugador que ya pagó no se vuelve a
  cobrar, pero un plantel nuevo sí.

## Riesgo aceptado

Que el club elija qué conceptos paga significa que puede inscribir un plantel
pagando solo las cuotas de sus jugadores, sin pagar la inscripción del equipo (o
al revés). La regla de "al menos uno" evita la planilla en S/ 0, pero no evita
que un club pague de menos si el reglamento del torneo exigía los dos. Es una
decisión de negocio tomada a conciencia; si más adelante hace falta, el modelo
admite marcar un concepto como obligatorio sin rehacer nada.
