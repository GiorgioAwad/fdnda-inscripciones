# Natación artística: campeonato de niveles

Fecha: 2026-08-18
Estado: aprobado, pendiente de plan de implementación
Fuente: «Bases Generales II Campeonato de Niveles de Natación Artística» (FDNDA, 2026)

## Por qué

La federación corre un campeonato donde los mismos deportistas compiten
separados en tres niveles técnicos —básico, intermedio y avanzado— y cada nivel
tiene su propia tabla de categorías por edad. Hoy el formulario de eventos solo
sabe de una lista plana de categorías, así que armar ese campeonato obliga a
escribir a mano «Básico — Infantil A», «Intermedio — Infantil A», … categoría
por categoría, sin que el sistema entienda que el nivel existe.

Es el mismo tipo de hueco que tapó la liga en polo: un formato de competencia
que el modelo no nombra.

## Qué existe hoy

Polo ya abrió el camino para «un formato de evento propio de una disciplina»:

- `Event.isLeague` es una bandera que solo aplica a `WATER_POLO`, y el
  formulario muestra su casilla condicionada a la disciplina elegida.
- `EventModality` guarda el resultado ya calculado (`price`) **y** el desglose
  que lo explica (`pricePerMatch`, `matchesPerTeam`, `expectedTeams`).
- El formulario manda los datos extra por categoría en un campo oculto JSON
  aparte (`presetLeagueTeamCounts`), sin ensuciar el textarea de categorías.
- `buildModalityRows` genera la matriz pruebas × categorías × sexos y la
  comparten la creación de eventos y el generador masivo.

Este diseño calca esas cuatro decisiones.

## Decisiones tomadas

| Pregunta | Decisión |
|---|---|
| ¿El nivel decide qué pruebas se generan? | No. Las pruebas se eligen una vez; el nivel agrupa categorías |
| ¿Incluimos Máster? | No. Solo básico, intermedio y avanzado |
| ¿Cómo existe el nivel en los datos? | Columna propia en la prueba, no solo texto |
| ¿Categorías precargadas de las bases? | Sí, precargadas y editables |
| ¿Los tres niveles son obligatorios? | No. Un nivel sin categorías no genera pruebas |
| ¿Juvenil y Junior, que admiten un año más en varones? | La categoría lleva un «desde» masculino opcional |

---

## 1 · Modelo

### Dos campos nuevos

| campo | tipo | significado |
|---|---|---|
| `Event.isLevelChampionship` | `Boolean @default(false)` | gemelo exacto de `isLeague` |
| `EventModality.level` | `ArtisticLevel?` | `null` en todo lo existente y en todo evento que no sea de niveles |

```prisma
enum ArtisticLevel {
  BASICO
  INTERMEDIO
  AVANZADO
}
```

Un CHECK SQL limita `level` a filas de `ARTISTIC_SWIMMING`, igual que hoy limita
`allowsCategoryUpgrade` a esa disciplina.

**Los defaults son el comportamiento histórico.** Ningún evento anterior a esta
migración cambia de precio, de elegibilidad ni de etiqueta.

### El nivel se escribe en dos lugares a propósito

La prueba guarda el nivel **en la columna `level`** y además **dentro de
`category`**, que queda `"Básico — Infantil A — Damas"`.

La redundancia es deliberada y tiene precedente: la liga guarda en `price` el
total ya multiplicado y en `pricePerMatch`/`matchesPerTeam` el desglose que lo
explica. Acá pasa lo mismo:

- La **columna** permite agrupar, filtrar y, más adelante, aplicar los límites
  de inscripción por nivel de las bases.
- La **etiqueta** mantiene inequívoca toda la cadena que ya lee `category` sin
  tocarle una línea: la descripción de la orden se arma como
  `disciplina — nombre — category` (`lib/registration-snapshots.ts`), y sin el
  nivel adentro una orden mostraría dos líneas idénticas para
  «Solo Libre · Infantil A — Damas» de básico y de avanzado.

Cambiar esa cadena para que lea la columna nueva significaría tocar snapshots,
resumen de orden, Excel y hoja impresa —todo lo que ya está pagado y auditado—
a cambio de nada que el usuario note.

---

## 2 · `src/lib/artistic-levels.ts` (nuevo)

Fuente única del formato, sin Prisma, testeable sola. Es el gemelo de
`lib/league.ts`.

- `ARTISTIC_LEVEL_VALUES` y sus etiquetas legibles.
- `levelCategoryPreset(seasonYear)` — las tablas de las bases con los años
  calculados desde el año de la temporada.
- `parseLevelCategories(json)` — valida lo que manda el formulario, igual que
  `parseLeagueTeamCounts`. Los campos ocultos también se manipulan desde el
  navegador, así que el servidor no confía en ellos.

### La aritmética de los años

Las bases miden la edad **al 31 de diciembre** del año del campeonato. Entonces,
para un año de temporada `Y`:

```
birthYearFrom = Y - edadMáxima     (el nadador más viejo admitido)
birthYearTo   = Y - edadMínima     (el más joven admitido)
```

`null` de cualquiera de los dos lados = sin tope por ahí, que es justo lo que
las bases expresan como «2018 o más» y «2011 o antes».

> **No sirve `birthYearForMaxAge`.** Esa función hace `Y - edad + 1` porque el
> «Sub-N» de polo mide la edad con otro corte. Usarla acá correría todas las
> categorías de artística un año y mandaría a cada nadador a la categoría
> equivocada.

### Las tablas de las bases

**Básico e intermedio** comparten tabla (sección VI de las bases):

| categoría | edad | `from` | `to` | `maleFrom` |
|---|---|---|---|---|
| Infantil D | 8 o menores | `Y-8` | — | — |
| Infantil A | 9 y 10 | `Y-10` | `Y-9` | — |
| Infantil B | 11 y 12 | `Y-12` | `Y-11` | — |
| Juvenil | F 13-15 · M 13-16 | `Y-15` | `Y-13` | `Y-16` |
| Junior/Senior | mayores de 15 | — | `Y-15` | — |

**Avanzado**:

| categoría | edad | `from` | `to` | `maleFrom` |
|---|---|---|---|---|
| 12 y menos | 12 y menores | `Y-12` | — | — |
| Juvenil | F 13-15 · M 13-16 | `Y-15` | `Y-13` | `Y-16` |
| Junior | F 15-19 · M 15-20 | `Y-19` | `Y-15` | `Y-20` |
| Senior | mayores de 15 | — | `Y-15` | — |

Con `Y = 2026` esto reproduce exactamente los años impresos en las bases.
Junior y Senior de avanzado se superponen: así lo dicen las bases, y no es
problema porque la categoría es una etiqueta y la elegibilidad la decide el
rango de cada prueba.

---

## 3 · El rango masculino

`CategorySpec` gana un campo:

```ts
/** Solo en artística: el «desde» que aplica a varones cuando las bases les
 *  dan un año más que a damas (Juvenil, Junior). null = mismo rango. */
maleBirthYearFrom: number | null
```

`buildModalityRows` ya itera los sexos dentro de cada categoría, así que solo
consulta ese campo al construir las variantes. Todos los caminos actuales lo
pasan en `null` y no cambian de comportamiento.

Qué sexo usa qué rango, explícito para que no quede a interpretación:

| `sexRule` | `birthYearFrom` |
|---|---|
| `FEMALE` | el de la categoría |
| `MALE` | `maleBirthYearFrom ??` el de la categoría |
| `MIXED` | `maleBirthYearFrom ??` el de la categoría |
| `ANY` | `maleBirthYearFrom ??` el de la categoría |

Un dueto mixto lleva un varón, así que `MIXED` usa el rango masculino: es el
único que deja entrar al varón que las bases admiten. `ANY` sigue la misma
lógica —admite a cualquiera, así que no puede ser más estrecho que `MALE`—
aunque las pruebas de artística no lo usen hoy.

`birthYearTo` nunca se desdobla: en las bases el año extra de los varones
siempre está del lado viejo del rango.

---

## 4 · El transporte del formulario

Las categorías de niveles viajan en un campo oculto JSON propio,
`presetLevelCategories`:

```json
[
  { "level": "BASICO", "label": "Infantil D", "from": 2018, "to": null, "maleFrom": null },
  { "level": "BASICO", "label": "Juvenil",    "from": 2011, "to": 2013, "maleFrom": 2010 }
]
```

`presetCategoriesText` y `parseCategorySpecs` **no se tocan**. El camino plano
de hoy —clavados, polo, artística sin niveles— sigue exactamente igual, que es
lo que hizo `presetLeagueTeamCounts` en su momento.

---

## 5 · El formulario

La casilla «Es un campeonato de niveles» va en el mismo bloque donde polo
muestra «Es una liga», condicionada a `discipline === "ARTISTIC_SWIMMING"`.

Al marcarla, el bloque plano de categorías se reemplaza por tres secciones
precargadas:

```
[x] Es un campeonato de niveles

▾ BÁSICO                                     [+ Agregar categoría]
   Infantil D    | desde 2018 | hasta —    | varones desde —
   Infantil A    | desde 2016 | hasta 2017 | varones desde —
   Infantil B    | desde 2014 | hasta 2015 | varones desde —
   Juvenil       | desde 2011 | hasta 2013 | varones desde 2010
   Junior/Senior | desde —    | hasta 2011 | varones desde —

▾ INTERMEDIO   (misma tabla)
▾ AVANZADO     12 y menos · Juvenil · Junior · Senior
```

- El año de la temporada elegida alimenta la precarga, así que cambiar de
  temporada la recalcula.
- Un nivel sin filas no genera pruebas. Los tres vacíos son un error.
- Desmarcar la casilla devuelve el bloque plano de hoy.
- Las filas son editables y borrables: la precarga es un punto de partida, no
  una jaula. Si las bases cambian el año que viene, el admin corrige sin
  esperar un despliegue.

### Crear y editar no son lo mismo

El bloque de categorías —plano o por niveles— vive dentro del `!event` que ya
existe en el formulario: **solo aparece al crear**. Editando un evento, la
casilla se muestra y guarda su estado, pero no regenera ni renombra ninguna
prueba; las pruebas de un evento existente se tocan desde el gestor de pruebas.

De ahí sale una consecuencia que conviene decir en voz alta: marcar la casilla
en un evento ya creado **no** convierte sus pruebas en pruebas de nivel. Deja el
evento marcado como campeonato de niveles y habilita el selector de nivel del
generador masivo, que es donde el admin les asigna nivel.

---

## 6 · El servidor

`eventSchema` gana `isLevelChampionship: z.boolean()` y
`presetLevelCategories: z.string().optional()`.

Guardas, calcadas de las de liga:

| guarda | mensaje |
|---|---|
| Solo artística puede marcarlo | «Solo un evento de natación artística puede ser un campeonato de niveles.» |
| No cambia con inscripciones vendidas | «El formato de niveles no puede cambiar porque el evento ya tiene inscripciones en una orden.» |
| Al menos un nivel con categorías, **si el admin eligió pruebas** | «Agrega las categorías de al menos un nivel.» |
| `MAX_BULK_MODALITIES` sobre la **suma** de los tres niveles | el mensaje de tope que ya existe |

La tercera guarda cuelga de que haya pruebas elegidas porque el formulario ya
admite crear un evento vacío y llenarlo después: sin pruebas no hay nada que
generar y exigir categorías sería pedir datos para nada.

La generación llama a `buildModalityRows` una vez por nivel, en orden básico →
intermedio → avanzado, con el `sortOrder` corrido entre llamadas. Las pruebas
nacen ordenadas por nivel sin que ninguna vista tenga que ordenarlas.

---

## 7 · Dónde se ve el nivel

| pantalla | cambio |
|---|---|
| Gestor de pruebas (admin) | encabezado por nivel; el generador masivo gana un selector de nivel cuando el evento es de niveles |
| Planilla (club) | `ModalityView` gana `level`; el tablero agrupa por nivel dentro de individuales y de equipo |
| Órdenes, Excel, hoja impresa, snapshots | **sin cambios** — ya leen el nivel dentro de `category` |

Esa última fila es el rendimiento de la decisión de la sección 1.

---

## 8 · Pruebas

`lib/artistic-levels.ts` es puro, así que lleva la carga de la verificación:

- `levelCategoryPreset(2026)` reproduce año por año las tablas impresas en las
  bases. Es el test que atrapa un `+1` de más.
- `levelCategoryPreset` con otro año corre todas las categorías en bloque.
- `parseLevelCategories` rechaza niveles desconocidos, años fuera de rango,
  `from > to` y JSON que no es un arreglo.
- `buildModalityRows` con `maleBirthYearFrom` da a `MALE` y `MIXED` el rango
  extendido y a `FEMALE` el propio.
- `buildModalityRows` sin `maleBirthYearFrom` genera exactamente lo de hoy.
- `saveEvent` rechaza niveles en una disciplina que no es artística, y rechaza
  el cambio de formato cuando el evento ya vendió inscripciones.

---

## Lo que queda fuera

- **Los límites de inscripción por nivel** de las bases (4 solos, 2 duetos, 1
  equipo por club y categoría). Son una regla de validación de planilla, no de
  configuración de evento, y merecen su propio diseño.
- **El nivel Máster.** Agregarlo es un valor más en el enum y una tabla más en
  `levelCategoryPreset`; no cambia el modelo ni migra datos.
- **Pruebas propias por nivel** (que básico no pueda hacer figuras). Hoy el
  admin destilda lo que no corresponde. Cuando estorbe, el preset por nivel
  entra sin tocar el esquema.
