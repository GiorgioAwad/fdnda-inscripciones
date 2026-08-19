# FDNDA — Afiliaciones e Inscripciones

Plataforma web de la **Federación Deportiva Nacional de Deportes Acuáticos**
(FDNDA) para la **afiliación anual** de clubes y deportistas y para la
**inscripción** a las pruebas de cada evento, con pago en línea (Izipay).

Disciplinas: **clavados**, **natación artística** y **polo acuático**. Cada una
se afilia y se cobra por separado (ver «Afiliación por disciplina»).

Proyecto independiente del ticketing (`fdnda-tickets`), sin integración ABIO/SUNAT.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Prisma 7** + PostgreSQL (driver `pg`)
- **NextAuth v5** (credenciales usuario/contraseña, JWT)
- **Tailwind CSS v4** (responsive mobile-first)
- **Izipay Web Core** (flujo redirect, adaptado del ticketing) con modo `mock` para desarrollo
- **xlsx** para importar el padrón y exportar reportes

## Desarrollo local

Requisitos: Node 22+, PostgreSQL local (este equipo: servicio `postgresql-x64-17`,
usuario `postgres`).

```bash
npm install
# .env ya apunta a postgresql://postgres:admin@localhost:5432/fdnda_inscripciones
npx prisma migrate dev     # crea/actualiza el esquema
# SOLO en una base descartable: habilita explícitamente el seed demo
DEMO_SEED_CONFIRM=SEED_FDNDA_DEMO \
DEMO_ADMIN_PASSWORD='<clave-local>' \
DEMO_REGATAS_PASSWORD='<clave-local>' \
DEMO_TERRAZAS_PASSWORD='<clave-local>' \
npm run db:seed
npm run dev                # http://localhost:3000
```

`prisma/seed.ts` está bloqueado por defecto porque introduce datos y contraseñas
conocidas. No se debe habilitar en staging ni producción. Las pruebas E2E usan
su propio `scripts/seed-e2e.ts` sobre una base aislada.

Credenciales del seed exclusivamente demo:

| Rol   | Usuario    | Contraseña    | Estado 2026                       |
| ----- | ---------- | ------------- | --------------------------------- |
| Admin | `admin`    | `DEMO_ADMIN_PASSWORD`    | —                                 |
| Club  | `regatas`  | `DEMO_REGATAS_PASSWORD`  | al día en las tres disciplinas    |
| Club  | `terrazas` | `DEMO_TERRAZAS_PASSWORD` | solo polo al día (clavados pendiente, artística sin afiliar) |

## Importación inicial de clubes y deportistas

Los dos libros históricos se procesan con un importador dedicado porque el de
artística/clavados tiene tres encabezados desplazados y el de polo usa otra
estructura. El comando es `dry-run` por defecto y no abre la base de datos:

```bash
npm run db:import-foundation -- --dry-run
```

La validación de origen detecta 120 filas de artística/clavados y 357 de polo:
476 documentos únicos, una fila idéntica repetida y 11 clubes. Dos filas de polo
tienen `0001-01-01` como nacimiento y no se pueden cargar sin inventar una fecha.
El modo aprobado exige `--exclude-invalid-rows`: deja esas filas en cuarentena,
carga 474 deportistas y las registra en un reporte sanitizado por fuente, fila y
campo pendiente. Cualquier otro conflicto de identidad detiene la operación. Los
mensajes usan una huella corta del documento, nunca el documento completo.

La escritura requiere una URL separada, confirmación literal y una salida
privada nueva para las contraseñas de entrega única:

```powershell
$env:IMPORT_DATABASE_URL='postgresql://.../fdnda_inscripciones'
npm run db:import-foundation -- --apply `
  --exclude-invalid-rows `
  --confirm=IMPORT_FDNDA_MASTERDATA `
  --retire-demo-fixtures `
  --credentials-out=.private-imports/credenciales-clubes.json
```

`--retire-demo-fixtures` no borra clubes, eventos, órdenes ni historial. Solo
desactiva los 32 deportistas sintéticos cuando coinciden documento y nombre
exactos, y rota las contraseñas demo conocidas de `regatas` y `terrazas`. Los
usuarios ya reales conservan su contraseña; los clubes sin usuario reciben uno
nuevo con contraseña aleatoria bcrypt (coste 12). El archivo de credenciales se
crea con exclusión mutua y no puede guardarse dentro del repositorio salvo en
`.private-imports/`, que Git ignora. Debe transferirse por un canal seguro y
eliminarse después.

## Afiliación por disciplina

Cada disciplina se afilia y se cobra **aparte**: un deportista que hace clavados
y polo paga dos cuotas y puede estar al día en una y deber la otra.

- `SeasonFee` guarda el tarifario anual: un par `clubFee`/`athleteFee` por
  disciplina. **Sin fila = esa disciplina no se afilia esa temporada.**
- `ClubAffiliation` y `AthleteAffiliation` llevan `discipline`; los únicos son
  `(club, temporada, disciplina)` y `(deportista, temporada, disciplina)`.
- `Athlete.disciplines` define qué cuotas le corresponden y por qué pruebas se
  le puede filtrar. **No** decide la elegibilidad de una prueba: eso lo sigue
  haciendo el año de nacimiento (`EventModality.birthYearFrom/To`) y el sexo.
- El bloqueo para inscribir es **por disciplina**: para una prueba de polo hacen
  falta la afiliación de polo del club **y** la del deportista. La planilla se
  valida autoritativamente en el servidor antes del checkout; el cliente nunca
  aporta precios, cupos ni reglas como valores confiables. El carrito queda
  reservado exclusivamente para afiliaciones.

La cuota queda **congelada** en cada afiliación emitida (`fee`): cambiar el
tarifario no altera lo que un club ya pagó.

### Qué eventos ve un club

El calendario del club (`/eventos`), su «próximo evento» de `/inicio` y el
selector de competencia de la planilla muestran **solo eventos de las disciplinas
en las que el club tiene afiliación de la temporada vigente**, ya sea `ACTIVE` o
`PENDING`. Un club sin ninguna afiliación no ve convocatorias: ve un mensaje que
lo lleva a `/afiliacion`.

La asimetría con el checkout es **deliberada** (`lib/club-events.ts`):

| | Criterio | Por qué |
|---|---|---|
| **Listado** | `ACTIVE` o `PENDING`, temporada vigente | Blando: el club que ya inició el trámite necesita ver el calendario y armar su planilla mientras paga. |
| **Checkout** | `ACTIVE` y vigencia que cubra **todas** las fechas del evento | Duro: `CLUB_AFFILIATION_REQUIRED` en `lib/plan-validation.ts`. Es el único que autoriza. |

Filtrar el listado es una comodidad, no un permiso. `selectRegistrationPlanEvent`
repite el filtro como guard de servidor, porque la competencia también puede
llegar por `?evento=slug` o por un enlace viejo.

## Roles y flujo

**Admin** (`/admin`):
- Temporadas: **tarifario por disciplina** (club + deportista), vigencia y
  **categorías por edad** (etiqueta informativa). Solo una temporada vigente.
- Panel de afiliaciones (`/admin/afiliaciones`): control de vigencias por
  **club × disciplina**, **marcar como pagada** una afiliación (depósitos fuera
  de la pasarela) y **export a Excel** (`/api/admin/afiliaciones/export`, con
  columna `DISCIPLINA`).
- Eventos: CRUD, abrir/cerrar inscripciones, pruebas/modalidades con **generador
  masivo** (matriz pruebas × categorías × sexos). Polo acuático se modela como
  una prueba por plantel (`minAthletes`/`maxAthletes`, p. ej. 7–13, con
  suplentes vía `isReserve`).
- Clubes: CRUD + usuario/contraseña por club (crear, resetear, desactivar).
- Padrón: importación por **Excel con vista previa** (plantilla descargable en
  `/api/admin/padron/plantilla`); upsert por número de documento. La columna
  **`DISCIPLINAS`** acepta varias separadas por coma (`CLAVADOS, POLO`); la hoja
  «Disciplinas» de la plantilla lista las formas aceptadas.
- Reportes por evento: totales, por prueba, por club, nominal, **cuotas por
  deportista** y órdenes, con **export a Excel**.

**Club** (`/inicio`): portal con barra lateral ordenada según el recorrido real
— Inicio · **Afiliación** · **Deportistas** · **Inscripciones** · Competencias ·
Pagos y Mi club. El único carrito es el de afiliaciones.
- `/inicio`: un solo **«próximo paso»** (afiliar club → afiliar deportistas →
  pagar el carrito → inscribir) y el estado de afiliación por disciplina.
- `/afiliacion`: **todo lo de afiliar en una pantalla**, con pestañas
  **Club** (una tarjeta por disciplina con su cuota y CTA), **Deportistas**
  (pares deportista × disciplina por regularizar, con filtro) e **Historial**
  (cuotas del club y de los deportistas, con columna Disciplina).
- `/afiliacion/carrito`: carrito de afiliaciones agrupado por disciplina, con
  subtotal por deporte.
- `/deportistas`: **solo el padrón** del club, con filtro por disciplina y un
  chip de estado por cada una. El alta busca **primero por documento** (evita
  duplicados; si figura en otro club avisa que el traspaso lo hace la
  federación) y pide las disciplinas que practica.
- `/inscripciones`: punto único para competir. Reúne el calendario **de sus
  disciplinas afiliadas** y los borradores, pagos pendientes e inscripciones
  pagadas; desde cada competencia se inicia o reanuda su planilla.
- `/eventos`: ruta anterior que redirige al punto único de inscripciones.
- `/inscripciones/nueva`: crea o reanuda el único borrador activo compatible.
- `/inscripciones/[planId]`: armador persistente; su resumen imprimible vive en
  `/inscripciones/[planId]/resumen?revision=N`.
- Planilla → orden → pago (Izipay). Inscripciones y afiliaciones se confirman
  **solo al pagar**. `/pagos` reúne las órdenes de ambos tipos; la orden pagada
  sirve como constancia.
- **Reporte de inscripción propio, en Excel**: `/api/club/eventos/[eventId]/export`,
  con hojas Resumen, Por prueba, Nominal, Cuotas por deportista y Órdenes. Se
  descarga desde la constancia de pago y desde la lista de planillas. Es el único
  endpoint `/api` abierto a rol CLUB; el `clubId` sale de la sesión y nunca de la
  URL, así que un club no puede pedir el reporte de otro.

Tras pagar, la constancia deja de ser una lista plana de texto: agrupa por
disciplina → prueba → categoría, con la tabla nominal (documento, año, sexo),
titulares y reservas, marca de «Sube de categoría», cuotas por deportista y
subtotales. Todo sale del snapshot congelado en la orden, así que renombrar el
evento o cambiar precios después no altera lo que el club compró.

## Armado de inscripciones

El recorrido de `/inscripciones/[planId]` tiene **dos pasos de trabajo** y cierra
con la revisión:

1. **Competencia** — una sola por planilla y por orden. La lista ya viene
   filtrada a las disciplinas afiliadas del club.
2. **Deportistas y pruebas** — una sola pantalla: se busca al deportista (en
   servidor, 30 por página), se agrega a la planilla y se marcan **sus pruebas
   individuales con una casilla** en la misma tarjeta. Duetos, equipos y
   planteles tienen su propio editor de formaciones, porque elegir titulares y
   reservas no cabe en una casilla.
3. **Revisión y pago** — desglose por disciplina e incidencias tipadas con
   acciones correctivas antes del checkout.

Marcar una prueba individual usa una sola mutación
(`toggleRegistrationPlanIndividualEntry`) que, bajo el mismo lock, suma al
deportista a la nómina si falta y crea la inscripción con **un solo** incremento
de revisión. Hacerlo en dos pasos abriría una ventana de carrera entre ambos.

`RegistrationPlan.currentStep` sigue guardando 1..4 del flujo anterior de cuatro
pasos: es solo una pista de reanudación, así que `lib/../inscripciones/steps.ts`
la mapea en lectura y escritura en vez de migrarla, y los borradores existentes
reanudan igual.

Cada cambio se autoguarda mediante mutaciones pequeñas y secuenciales con
`expectedRevision`. Si otra pestaña modificó la planilla, el servidor devuelve un
conflicto y nunca sobrescribe silenciosamente. Los borradores pueden quedar
incompletos, pero validación y pago permanecen bloqueados hasta corregir afiliación,
temporada, disciplina, edad, sexo, composición, duplicados, reservas, precio o cupo.

El resumen imprimible espera a que termine el autoguardado y exige la revisión
persistida indicada en la URL; si cambió, no imprime una mezcla de versiones. Al
pagar, la planilla queda inmutable. Antes del cierre puede abrirse una planilla
suplementaria para la misma competencia y lo ya pagado aparece bloqueado en el
resumen global.

Compatibilidad temporal: `/carrito`, `/mis-inscripciones` y `/eventos` redirigen
a `/inscripciones`; `/eventos/[slug]` inicia o reanuda una planilla para ese
evento y `/eventos/[slug]/resumen` lleva a su resumen vigente.

### Cómo cobra y cómo mide edades cada disciplina

`EventDisciplineConfig` guarda, por evento y disciplina, qué cobra y la regla de
edad. **Ausencia de fila = cobra por formación y no cobra cuota, con regla de
edad `RANGE`**, que es el comportamiento histórico: por eso los eventos
anteriores a esta tabla no cambiaron de precio ni de elegibilidad y no hubo que
hacer backfill.

El cobro son **dos conceptos independientes**, que pueden estar prendidos a la
vez:

| Concepto | Qué cobra |
|---|---|
| `chargesEntry` | El precio de cada prueba, una vez **por formación** (natación artística). |
| `chargesAthleteFee` | **Cuota fija por deportista** para toda la disciplina en el evento, sin importar cuántas pruebas haga (clavados). Requiere `athleteFee` no nulo y `> 0`. Las formaciones se registran con importe 0. |

Polo acuático tiene los dos prendidos a la vez: cobra la inscripción del plantel
Y una cuota por jugador. Cuando eso pasa —la disciplina cobra los dos
conceptos—, la planilla (`RegistrationPlan.paysEntry` / `paysAthleteFee`, ambos
anulables; `null` = "lo que diga el evento") deja **elegir al club** cuáles paga.
Esa elección **solo se aplica donde el evento realmente ofrece elegir**: en una
disciplina que solo cobra uno de los dos conceptos, la config del evento manda
sin excepción, aunque el club haya apagado esa bandera pensando en otra
disciplina de la misma planilla multidisciplina. `computePlanPricing`
(`lib/event-pricing.ts`) es el único lugar que decide esto; el resto de las
capas lee `chargedEntry` / `chargedAthleteFee` (el resultado, ya con la
elección aplicada) en el desglose por disciplina en vez de recalcularlo por su
cuenta.

Con `chargesAthleteFee`, cada cuota cobrada se materializa como una fila
`EventAthleteFee` con único `(evento, disciplina, deportista)`. Eso es lo que
hace que una **planilla suplementaria** con más pruebas del mismo deportista no
vuelva a cobrarle: si la disciplina no cobra por formación (o el club eligió no
pagar ese concepto), la orden puede quedar en **S/ 0** y se confirma sola,
porque no hay pasarela que cobre cero y dejarla pendiente congelaría la
planilla.

Las cuotas se crean **solo en el checkout**, nunca al editar: así el autoguardado
no cambia y no quedan filas huérfanas ocupando el único. Si el pago falla o
expira, vuelven a `IN_CART` y el reintento las reutiliza.

`EventDisciplineConfig.pricingMode` (`PER_ENTRY` / `PER_ATHLETE`) es el enum
excluyente que este modelo de dos conceptos reemplazó: no distinguía "cobra
ambos" de "cobra uno solo", que es justo lo que polo necesita. La columna sigue
en la tabla y `saveEvent` la sigue escribiendo (derivada de `chargesEntry` /
`chargesAthleteFee`) durante esta release nada más, para que una instancia
corriendo con el código anterior —convive con la nueva durante el
despliegue— siga leyendo el precio correcto en vez de cobrar de menos o
autoconfirmar una orden en S/ 0. Se retira por completo, columna incluida, en
la próxima release.

| Regla de edad | Qué significa |
|---|---|
| `RANGE` | Ventana cerrada `birthYearFrom..birthYearTo`, ambos opcionales. |
| `MAX_AGE_ONLY` | Categorías **«Sub-N» u Open**: `birthYearTo` siempre es `null`; `birthYearFrom` expresa el tope Sub-N y también es `null` en Open. |

Ojo con la semántica de Sub-N: «Sub-18 en la temporada 2026» es
`birthYearFrom = 2009`, `birthYearTo = null`, es decir *nacidos en 2009 o
después*. Por eso un jugador sub-13 (2014) entra a sub-18, pero un sub-18 (2009)
nunca baja a sub-13 (`birthYearFrom = 2014`). Una categoría Open anula ambos
campos de forma explícita y admite cualquier edad.

### Sube de categoría (natación artística)

La regla solo puede activarse en **natación artística**. El administrador la
configura explícitamente por prueba, incluidos los presets Solo, Figuras y
Estrellas. Se persiste `categoryUpgradeBirthYear` como snapshot y debe coincidir
con el año de la categoría inferior inmediata de la temporada; el servidor no la
infiere por el nombre de la prueba. La pantalla y la hoja de resumen marcan cada
caso con **«Sube de categoría»**. El fallback histórico `birthYearTo + 1` existe
solo para compatibilidad y el backfill lo materializa.

Rutas antiguas: `/deportistas?tab=por-afiliar` y `?tab=historial` redirigen a las
pestañas equivalentes de `/afiliacion`.

### Campeonato de niveles (natación artística)

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

## Crear un evento

**Un evento pertenece a una disciplina.** El formulario empieza por elegirla y
esa elección gobierna todo lo demás: el modo de cobro, la regla de edad y las
pruebas que se generan al guardar (`src/lib/event-presets.ts`). Un campeonato que
junte clavados y polo se crea como dos eventos.

Los eventos multidisciplina creados con el formulario anterior conservan su
arreglo y se editan en solo lectura para esa parte: reducirlos a una disciplina
borraría pruebas que pueden tener inscripciones pagadas.

Una vez que el evento vendió inscripciones, quedan congelados la disciplina, el
modo de cobro y la cuota: cambiarlos alteraría lo que un club creyó comprar.

## Agregar una disciplina

1. `src/lib/disciplines.ts` — etiqueta, icono y colores, incluido `lane` (fuente
   única: de ahí leen menús, chips, formularios, reportes y los `z.enum`).
2. `prisma/schema.prisma` — valor nuevo en `enum Discipline`, en **su propia
   migración**: PostgreSQL no deja usar un valor de enum en la misma
   transacción en que se agregó.
3. `src/lib/event-presets.ts` — cómo cobra, cómo mide edades y qué pruebas trae.
4. Fijarle la cuota del año en `/admin/temporadas`.

## Sistema visual

Todo vive en `src/app/globals.css`, con tres bloques que no significan lo mismo:

| Bloque | Para qué |
|---|---|
| `:root` | El **valor** literal: hex, rem, la cadena del `box-shadow`. Punto único de cambio. |
| `@theme inline` | El **alias** que genera la utilidad de Tailwind apuntando a `:root`. Cambiar el valor no obliga a recompilar el alias. |
| `@theme` (sin `inline`) | Sobrescribe la **escala nativa** de Tailwind (`--text-*`, `--font-weight-*`). Aquí no queremos indirección. |

La regla que mantiene esto sano: **lo que es escala se cambia en el token; lo
que es rol, en el componente. Nunca al revés.** Subir `--text-xs` un punto
corrige 188 usos sin tocar un `.tsx`; cambiar 188 clases a mano es cómo se
rompe.

### El andarivel

La firma del producto es una franja horizontal en el borde superior de toda
superficie que carga datos, y **su color codifica la disciplina**: navy es
Clavados, rojo Natación Artística, turquesa Polo Acuático — la misma asignación
que ya usaban el chip y el acento. Si el contenido toca varias, se reparte en
segmentos en el orden canónico de `DISCIPLINE_VALUES`, para que dos pantallas
distintas nunca pinten el mismo par al revés.

**Sin disciplina, sin franja.** `LaneBand` devuelve `null` con la lista vacía, y
eso es deliberado: la decoración es información, y una franja que no significa
nada es ruido.

Se pasa como prop opcional a `Card`, `TableContainer`, `StatCard` y
`PageHeader`. Todas son aditivas: sin la prop, el DOM es el de siempre.

En `TableContainer` la franja vive en un envoltorio y no dentro del elemento que
hace scroll; si se mueve, se desplaza con la tabla y desaparece de la vista.
`role="region"`, `tabIndex` y `aria-label` tienen que quedarse en el que
scrollea o el scroll deja de ser alcanzable por teclado.

### Elevación, radios y escala

Tres pasos de sombra con rol, derivados del azul institucional y nunca de gris:
sobre un fondo azulado una sombra neutra se lee sucia.

- `shadow-raised` — tarjetas en reposo, botones sólidos, `StatCard`.
- `shadow-floating` — hover de tarjeta enlazada, barras sticky.
- `shadow-overlay` — diálogo y cajón móvil.

Cuatro radios (`chip`, `control`, `surface`, `panel`) y una escala tipográfica
con tres peldaños propios: `text-eyebrow` (sustituye la cadena `text-xs
font-bold uppercase tracking-wider`), `text-metric` (el número héroe) y
`text-display` (el titular del login).

### Tipografía y cifras

Superfamilia **IBM Plex** en tres roles: Sans para cuerpo, Sans Condensed para
títulos y cabeceras de tabla, Mono para toda cifra. La condensada no es gusto:
devuelve ~11% de ancho a las tablas de 9 y 10 columnas.

Se carga con `next/font/google`, que **descarga en build y sirve desde
`/_next/static/media/`**: no hay petición a Google en runtime y por eso respeta
la CSP `font-src 'self' data:`. El build necesita red hacia `fonts.gstatic.com`;
si algún día tuviera que ser hermético, la salida es `next/font/local` con los
`.woff2` versionados, mismos nombres de variable.

⚠️ **IBM Plex llega a 700 y no más: no existe el peso 800.** Por eso
`--font-weight-extrabold` y `--font-weight-black` están mapeados a 700. Sin ese
mapeo, `font-extrabold` dejaría de distinguirse de `font-bold` y la jerarquía se
aplanaría en vez de corregirse.

Toda cifra del producto —soles, documentos, años, códigos de orden, contadores—
lleva la clase `.num`: mono, tabular y a `0.94em`, que compensa el mayor ancho
del monoespaciado para que una tabla de diez columnas no crezca.

### Impresión

Lo que este producto emite en papel es documentación federativa. `@page` A4 con
márgenes, `thead` repetido entre páginas, y `print-landscape` para el reporte de
evento, donde nueve columnas no entran en vertical. `PrintSheetHeader` y
`PrintSheetFooter` (`src/components/print-sheet.tsx`) ponen membrete y casilla de
firma del delegado.

La franja **sí** se imprime, con `print-color-adjust: exact`, porque identifica
de qué disciplina es la hoja — pero eso depende de «Gráficos de fondo», que
viene apagado, y por eso el botón de imprimir lo avisa.

Dos limitaciones conocidas: `counter(page)` solo funciona en los *margin boxes*
de `@page`, que ningún navegador de escritorio implementa, así que la numeración
la pone el pie nativo del diálogo; y el reporte imprime la página visible,
porque sus tablas van de 50 en 50.

### Tablas en móvil

Las de 8 o más columnas se sustituyen por tarjetas bajo `md:` con `TableCards` /
`TableCard` / `TableField`. **No se aplica a las pantallas cubiertas por la
suite E2E**: dos árboles visibles a la vez rompen el modo estricto de Playwright.

## Pagos

`PAYMENTS_MODE` controla la pasarela:

- `mock` (desarrollo): panel de pago simulado (aprobar/fallar) en `/pago/[orderId]`.
  **Nunca usar `mock` apuntando a una base de producción.**
- `izipay` (sandbox y producción): flujo Web Core en **pop-up** — el SDK monta un
  iframe sobre la página y el club no sale del portal. Rutas:
  - `POST /api/payments/izipay/session` — crea la sesión (Token/Generate)
  - `POST /api/payments/izipay/validate` — confirmación primaria; recibe del
    navegador la respuesta firmada del `callbackResponse` del SDK
  - `POST /api/payments/izipay/webhook` — IPN de respaldo (URL a registrar en
    Izipay). Su `GET` es el health check que Izipay consulta al registrarla.
  - `GET|POST /api/payments/izipay/redirect-result` — solo si Izipay degrada a
    redirect por su cuenta
  - `GET /api/checkout/runtime` — sirve el SDK de Izipay desde nuestro propio
    origen. Los bloqueadores de anuncios bloquean su CDN por dominio y el
    checkout no abre; el cliente lo intenta primero y cae al CDN si falla.

  Variables: `IZIPAY_MERCHANT_CODE`, `IZIPAY_API_KEY`, `IZIPAY_HASH_KEY`,
  `IZIPAY_PUBLIC_KEY`, `IZIPAY_ENDPOINT` y `NEXT_PUBLIC_APP_URL` (dominio público).
  La confirmación es idempotente (redirect + IPN pueden llegar ambos). Los límites
  de parámetros Web Core se normalizan en `src/lib/izipay-config.ts`.

  En pop-up la confirmación primaria va del navegador a nuestro propio servidor,
  así que el camino feliz se puede probar en `localhost`. El IPN sí es servidor a
  servidor y exige un túnel público para ejercitarse:
  ver [docs/IZIPAY_PRUEBAS.md](docs/IZIPAY_PRUEBAS.md) para el paso a paso con las
  credenciales sandbox ya configuradas.

Un pago **rechazado en el pop-up deja la orden `PENDING`** a propósito: el club
sigue en la página y puede reintentar con otra tarjeta sin rearmar la planilla ni
perder sus cupos.

Las órdenes `PENDING` expiran a los 30 minutos. Al expirar o fallar el pago se
liberan los cupos, las inscripciones vuelven a `IN_CART` y la planilla vuelve a
`DRAFT`. La expiración perezosa permanece como respaldo, pero producción debe
invocar cada minuto `GET` o `POST /api/internal/maintenance/expire-orders` con
`Authorization: Bearer <MAINTENANCE_SECRET>` o el encabezado
`x-maintenance-secret`.

## Modelo de datos (resumen)

`Club` 1—N `Athlete` (padrón, upsert por `docNumber`; `disciplines Discipline[]`).
`Season` (temporada anual: vigencia, una `isCurrent`) 1—N `SeasonFee` (tarifario
por disciplina) y 1—N `Category` (por disciplina y años de nacimiento; solo
etiqueta).
`ClubAffiliation` y `AthleteAffiliation` (club/deportista × temporada ×
**disciplina**, estado `PENDING → ACTIVE`; "vencida" se **deriva** de `validTo`,
no se persiste). El `clubId` de `AthleteAffiliation` guarda el club de esa
temporada: es el histórico que permite listar reafiliaciones. `PENDING` sin
`activeOrderId` = en el carrito.
`Event` pertenece explícitamente a una `Season` (el vínculo queda nullable durante
el rollout legado) y tiene N `EventModality`: disciplina, sexo
`MALE|FEMALE|MIXED|ANY`, rango de años, ascenso explícito, integrantes, precio y
cupo opcional.

`RegistrationPlan` conserva club, evento, estado
`DRAFT → AWAITING_PAYMENT → PAID` (o `ABANDONED`), `revision`, paso actual y orden
activa. `RegistrationPlanAthlete` conserva la nómina aun sin pruebas. Índices
únicos parciales garantizan un borrador activo sin evento por club y uno activo
por club/evento; una planilla pagada permite crear un suplemento.

`Registration` (club × modalidad, estado
`IN_CART → PENDING_PAYMENT → PAID`) representa una **formación**, no un integrante,
y se vincula a la planilla mediante `planId`. `RegistrationAthlete` guarda sus
integrantes y reservas. Solo `PENDING_PAYMENT` y `PAID` consumen capacidad, una
unidad por formación; los borradores no reservan cupo.

`Order` (`kind AFFILIATION|REGISTRATION`) enlaza `registrationPlanId` y `eventId`
cuando corresponde. Cada `OrderItem` de inscripción congela un
`registrationSnapshot` estructurado con evento, prueba, reglas, precio, club y
deportistas; constancias y reportes pagados priorizan ese snapshot aunque luego
cambien los datos administrativos. Los históricos sin snapshot conservan
`description` y `unitPrice` como fallback legible; `Order.isLegacy` identifica
los históricos multicompetencia. El ciclo idempotente de las órdenes vive en
`src/lib/orders.ts`.

**El dinero sale del `OrderItem`, no del snapshot.** El snapshot es la verdad
sobre *qué* se compró; `unitPrice` lo es sobre *cuánto* se cobró, porque es lo
que suma `Order.totalAmount`. Mientras el precio sea por formación ambos
coinciden, pero con cuota fija por deportista la formación queda en 0 y la prueba
conserva su precio de lista: leer `modality.price` ahí duplicaría la recaudación.

Los ítems de cuota llevan su propio snapshot (`version: 2`, `kind:
"ATHLETE_FEE"`) porque no tienen prueba ni formación. El parser v1 quedó intacto:
es el que sostiene todo el histórico, y una versión desconocida sigue cayendo al
fallback por `description`.

Bases que ya operaban antes del módulo: `npm run db:backfill-afiliaciones`
genera la temporada vigente, su tarifario y afiliaciones `ACTIVE` a clubes y
deportistas existentes —a cada deportista solo en las disciplinas que tiene
registradas— (idempotente; acepta `--year`, `--club-fee`, `--athlete-fee`,
`--disciplines=DIVING,WATER_POLO`, `--dry-run`).

La migración `afiliacion_por_disciplina` convierte una base con cuota única:
copia `clubFee`/`athleteFee` al tarifario de clavados y artística, conserva cada
afiliación existente como **clavados** y clona las `ACTIVE` como **artística**
con cuota 0 (ya estaban cubiertas por el pago único anterior). Las `PENDING` no
se clonan: nunca se pagaron.

## Despliegue y backfill de planillas

El despliegue es aditivo y mantiene nullable los vínculos nuevos durante el
rollout. Ejecutar primero el esquema compatible y luego el backfill idempotente:

```bash
npx prisma migrate deploy
npm run db:backfill-planillas -- --dry-run
npm run db:backfill-planillas
npm run db:backfill-planillas
```

La última ejecución debe informar cero cambios. Conservar y revisar la sección
«Revisión manual recomendada»: el script asigna temporada solo cuando cubre todas
las fechas; ante una coincidencia ambigua usa la vigente y lo reporta. También
desactiva ascensos fuera de artística, materializa el año adicional y crea
planillas/nóminas para inscripciones y órdenes de una sola competencia.

Las órdenes históricas multicompetencia no se dividen, recalculan ni enlazan a una
planilla; quedan marcadas durablemente con `isLegacy` y una etiqueta «Legado» en
pagos/reportes. Sus importes, estados y referencias Izipay permanecen intactos. Los
snapshots históricos quedan `null` deliberadamente y siguen siendo legibles con
los campos legados. Hacer obligatorios los vínculos nullable corresponde a una
migración posterior, únicamente después de validar conteos, montos y referencias.

## Pruebas

```bash
npm test
npm run test:integration
npm run test:migration
npm run test:performance
npx playwright install chromium
npm run test:e2e

npm run lint
npx tsc --noEmit
npx prisma validate
npm run build
```

`npm test` es unitario y no usa base de datos. Integración, migración, rendimiento
y E2E crean, migran y eliminan bases PostgreSQL efímeras; `DATABASE_URL` debe
apuntar a una instancia **de pruebas** cuyo usuario pueda crear y eliminar bases.
Nunca ejecutar estos runners con credenciales de producción. E2E fuerza pagos
`mock` y un puerto local aleatorio. `npm run test:e2e:local` se reserva para
depuración contra una instalación ya preparada y puede mutar sus datos.

### Escala y rendimiento

`npm run test:performance` crea 100 clubes/usuarios, un club con 1.000
deportistas, 300 pruebas y ejecuta lotes de 100 operaciones simultáneas. Falla si
carga, búsqueda o autoguardado superan p95 2 s, si checkout supera p95 3 s o si
no quedan exactamente 100 órdenes únicas y 100 planillas `AWAITING_PAYMENT`.

Última medición local (Node 22.18, PostgreSQL 17.6, i5-10300H/8 hilos, pool 10):

| Operación | p95 |
| --- | ---: |
| Carga paginada, 1.000 deportistas | 324,1 ms |
| Búsqueda en servidor | 249,0 ms |
| Autoguardado de selección | 370,7 ms |
| Autoguardado de formación | 516,6 ms |
| Checkout interno, 100 simultáneos | 1.004,3 ms |

La integración separada disputa concurrentemente el último cupo y verifica
ausencia de sobreventa, filas parciales y órdenes duplicadas. Estos resultados son
reproducibles para detectar regresiones en este equipo; antes de producción deben
repetirse contra infraestructura equivalente y con observabilidad de red/CPU/DB.

## Fechas y zona horaria

- Fechas de calendario (`@db.Date`) se muestran en **UTC** para no correr el día.
- El cierre de inscripciones se ingresa y muestra en **hora de Lima (UTC-5 fijo)**.

## Producción

La preparación, release, conciliación de pagos, backups, monitorización y
rollback están en [`docs/PRODUCTION_RUNBOOK.md`](docs/PRODUCTION_RUNBOOK.md).
El despliegue se hace en Vercel: [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md).
La alternativa evaluada con AWS App Runner queda documentada y sin uso en
[`docs/AWS_DEPLOYMENT.md`](docs/AWS_DEPLOYMENT.md).

Los dos documentos distinguen los controles implementados en el repositorio de
los pasos externos obligatorios (Neon, dominio, Izipay, privacidad, MFA,
scheduler y alertas). No habilitar pagos reales hasta completar el checklist de
salida y un pago controlado en el dominio definitivo.
