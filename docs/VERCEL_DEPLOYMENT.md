# Despliegue en Vercel

Ruta de despliegue elegida para esta aplicación. Vercel resuelve ejecución,
HTTPS, dominio, despliegues inmutables y rollback. El programador de
mantenimiento vive en Cloudflare Workers. La base sigue siendo Neon, externa.

`docs/AWS_DEPLOYMENT.md` describe la alternativa evaluada con App Runner y no
está en uso.

## Plan y límites que afectan a esta aplicación

- **Cron externo.** El equipo usa Hobby; el mantenimiento por minuto se ejecuta
  mediante Cloudflare Workers. Ver [`scheduler/`](../scheduler/README.md).
- **Cuerpo de petición: 4,5 MB.** [`next.config.ts`](../next.config.ts) ya fija
  `bodySizeLimit: "4mb"` en las server actions para quedar por debajo. La
  importación de padrón es el flujo que roza ese techo.
- **Duración máxima de función.** El valor por defecto depende del plan. Si la
  exportación a Excel de un evento grande se corta, subirla en la ruta concreta
  con `export const maxDuration` y no de forma global. Las candidatas son
  `api/admin/afiliaciones/export`, `api/admin/eventos/[id]/export`,
  `api/club/eventos/[eventId]/export` y `api/admin/padron/plantilla`.
- **Región.** [`vercel.json`](../vercel.json) fija `iad1` (Washington D.C.), que
  es `us-east-1` y coincide con el proyecto Neon. Aplicación y base deben
  compartir región; cada consulta cruzada suma latencia al checkout.

## `output: standalone` y Vercel son incompatibles

[`next.config.ts`](../next.config.ts) activa `output: "standalone"` **solo cuando
la variable `VERCEL` no está definida**. No es una preferencia: en modo
standalone Next empaqueta sus propias dependencias y no emite los archivos de
traza `.nft.json`, y el paso `onBuildComplete` de Vercel muere con
`ENOENT: .next/next-server.js.nft.json`.

Fuera de Vercel el modo se conserva porque el `Dockerfile` copia
`.next/standalone` y CI construye la imagen. No sustituir esa condición por un
valor fijo sin comprobar los dos caminos.

## Dos proyectos: staging y producción

El runbook exige un entorno de *staging* separado. En Vercel se resuelve con
**dos proyectos** apuntando al mismo repositorio, cada uno con sus variables y
su base:

| | `fdnda-inscripciones-staging` | `fdnda-inscripciones` |
| --- | --- | --- |
| `APP_ENV` | `staging` | sin definir |
| Base Neon | proyecto/rama de staging | `fdnda-inscripciones-prod` |
| Izipay | sandbox, o `PAYMENTS_MODE=mock` | producción |
| Registro del banco de datos | no aplica a datos ficticios | pendiente de FDNDA; código opcional en la app |
| Dominio | el `*.vercel.app` sirve | dominio propio |

`APP_ENV` solo relaja controles con el valor exacto `staging`. Cualquier otro
valor, y su ausencia, se tratan como producción: olvidarla nunca abre la puerta.
Lo que **no** se relaja en staging es el transporte TLS de la base, la longitud
mínima de los secretos ni la exigencia de HTTPS en la URL pública.

> Un despliegue con `APP_ENV=staging` jamás debe apuntar a la base de
> producción: aceptaría inscripciones reales pagadas con tarjetas de prueba. La
> primera línea de log de cada instancia (`deployment_started`) muestra el nivel
> y la base usada justamente para poder detectarlo de un vistazo.

Activar **Deployment Protection** en el proyecto de staging: expone la
aplicación completa.

## Variables de entorno

Cargarlas en **Project Settings → Environment Variables**, marcando
exclusivamente el entorno **Production**.

> Si se marcan también en Preview, cada rama desplegada escribirá en la base
> real de inscripciones. Es el error más caro de esta plataforma.

Partir de [`env.example`](../env.example). Reglas de producción en
[`PRODUCTION_RUNBOOK.md`](PRODUCTION_RUNBOOK.md). Específico de Vercel:

| Variable | Valor |
| --- | --- |
| `APP_ENV` | `staging` en el proyecto de pruebas; **sin definir** en producción |
| `DATABASE_URL` | Neon **pooled** (host con `-pooler`), rol `fdnda_app`, `sslmode=require` |
| `DATABASE_POOL_MAX` | `2` |
| `MAINTENANCE_SECRET` | aleatorio, mínimo 32 caracteres |
| `CRON_SECRET` | prescindible con Cloudflare; si se conserva, usar el mismo valor que `MAINTENANCE_SECRET` |
| `NEXT_PUBLIC_APP_URL` | `https://inscripcionesfdnda.pe` (HTTPS, sin ruta ni query) |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Base64 de 32 bytes, estable entre despliegues |
| `PAYMENTS_MODE` | `izipay` |
| `IZIPAY_*` | credenciales y endpoint reales de producción |

`DIRECT_DATABASE_URL` **no se carga en Vercel.** Solo la leen las migraciones
([`prisma.config.ts`](../prisma.config.ts)), y cargarla aquí daría a las
funciones web las credenciales del rol con permisos de DDL.
[`src/lib/env.ts`](../src/lib/env.ts) no la exige en runtime justamente por eso,
pero sí la valida si alguien la define.

`NEXT_PUBLIC_APP_URL` se resuelve **en tiempo de build**: alimenta el
`allowedOrigins` de las server actions. Cambiar el dominio obliga a redesplegar,
no basta con editar la variable.

## Base y migraciones

No añadir `prisma migrate deploy` al comando de build. En Vercel el build corre
en cada despliegue, incluidas las vistas previa, y una migración debe ejecutarse
una sola vez y de forma controlada.

El comando de build correcto es el del `package.json`: `prisma generate && next build`.

Las migraciones se ejecutan aparte, desde un equipo autorizado o desde CI, con
la conexión directa y el rol `fdnda_migrate`:

```powershell
$env:DOTENV_CONFIG_PATH=".env.prod-neon"
npm run db:verify-neon
npm run db:migrate:deploy
npm run production:preflight
```

Crear una rama o snapshot de Neon antes de cada migración de producción.

## Programador de mantenimiento

El proyecto Vercel usa el plan Hobby. El cron por minuto vive en el Worker
[`scheduler/`](../scheduler/README.md), que invoca el endpoint protegido por
`MAINTENANCE_SECRET`. `vercel.json` no declara cron para evitar el límite de
frecuencia del plan Hobby.

El Worker está desplegado contra la URL temporal `https://fdnda-inscripciones.vercel.app/`.
El dominio canónico previsto es `https://inscripcionesfdnda.pe`; configurar
`NEXT_PUBLIC_APP_URL` en Vercel. Después de cada despliegue comprobar sus
Cron Events y Workers Logs. Alertar si no hay ejecución en tres minutos, si
aparece `maintenance_failed` o si `ordersRequiringPaymentReview` es mayor que
cero. Los pagos inciertos requieren conciliación manual.

### Mientras no haya cron

`expireStaleOrders()` también se ejecuta de forma perezosa desde carrito, pago,
listado de pagos, panel de administración, creación de sesión de Izipay y las
acciones de planillas. En staging eso basta: las órdenes caducan en cuanto
alguien recorre esos flujos.

Lo que la vía perezosa **no** cubre, y por eso producción necesita el cron: la
liberación puntual de cupos cuando nadie navega, la poda de
`pruneSecurityRateLimits` y la señal periódica de
`payment_reconciliation_required`.

## Dominio e Izipay

1. Añadir `inscripcionesfdnda.pe` en **Project Settings → Domains** y completar el DNS.
2. Esperar el certificado y fijar la redirección a la URL canónica.
3. Definir `NEXT_PUBLIC_APP_URL=https://inscripcionesfdnda.pe` y **redesplegar**.
4. Registrar en Izipay `https://inscripcionesfdnda.pe/api/payments/izipay/webhook` y las URL de
   validación y retorno que genere la integración.
5. Ejecutar un pago real controlado antes de abrir a los clubes.

El IPN es servidor-a-servidor: si el despliegue de producción queda detrás de
Deployment Protection, Izipay no podrá alcanzarlo.

## Vistas previa

Las vistas previa despliegan cada rama con `NODE_ENV=production`. Dos
consecuencias:

- Sin las variables de base marcadas en Preview, una vista previa no arranca.
  Eso es lo deseado: usar una rama de Neon aparte si se necesita un preview
  funcional, nunca la base de producción.
- Las server actions comprueban el origen contra `NEXT_PUBLIC_APP_URL`, así que
  en un dominio `*.vercel.app` quedarán bloqueadas salvo que se defina esa
  variable por entorno.

Activar **Deployment Protection** en las vistas previa: exponen la aplicación
completa y esta trata datos personales de menores.

## Observabilidad y rollback

- Logs en el panel del proyecto. Definir retención y, si el plan lo permite,
  un log drain hacia el destino centralizado.
- Comprobar `/api/health/live` y `/api/health/ready` tras cada despliegue.
- Rollback de código: promover el despliegue anterior desde el panel (Instant
  Rollback). No revertir migraciones durante un incidente.
- Rollback de datos: restauración PITR de Neon sobre otra rama, validar conteos
  y luego cambiar `DATABASE_URL`.
- Rotar un secreto exige un **nuevo despliegue** para que las funciones lo lean.

## Qué no resuelve Vercel

Ejecución y HTTPS. No sustituye los pasos externos del checklist de salida:
Izipay de producción, dominio, tratamiento de datos personales y registro del
banco de datos, MFA para administradores, backups con restauración ensayada,
alertas con responsable de guardia, entrega segura de credenciales de clubes y
las pruebas de aceptación. Seguir [`PRODUCTION_RUNBOOK.md`](PRODUCTION_RUNBOOK.md).
