# Programador de mantenimiento de producción

Este Worker ejecuta cada minuto `POST /api/internal/maintenance/expire-orders` en la aplicación de producción. No tiene ruta HTTP pública. El 29 de septiembre de 2026 se migró a la cuenta Cloudflare de FDNDA (`comercial@fdnda.org`, cuenta `4670d3f9ab3a0e40e7285bc9fc714e50`) y se retiró el Worker de la cuenta personal. Conserva el Cron Trigger `* * * * *` y apunta temporalmente a `https://fdnda-inscripciones.vercel.app/`. Se verificaron ejecuciones automáticas con `maintenance_complete` después de la migración.

## Configuración y cambio de dominio

1. Comprobar que `GET /api/health/ready` responda 200 en el origen HTTPS de producción. Al configurar `inscripcionesfdnda.pe`, actualizar `NEXT_PUBLIC_APP_URL=https://inscripcionesfdnda.pe` en Vercel Production y redesplegar.
2. Usar un único secreto aleatorio de al menos 32 caracteres para `MAINTENANCE_SECRET` en Vercel Production y este Worker. Si el secreto ya existe en Vercel y no se puede recuperar, rotarlo en ambos servicios antes de activar el cron. No escribir el secreto en el repositorio, argumentos de terminal ni chat.
3. Desde este directorio ejecutar `npm ci`, `npm run check` y `npx wrangler whoami`. Debe mostrarse el perfil `fdnda`, la sesión `comercial@fdnda.org` y la cuenta `4670d3f9ab3a0e40e7285bc9fc714e50`, fijada también en `wrangler.jsonc`.
4. Crear temporalmente `.env.deploy` en este directorio, con dos líneas: `APP_ORIGIN=https://inscripcionesfdnda.pe/` (origen HTTPS canónico y barra final) y `MAINTENANCE_SECRET=<mismo secreto que Vercel>`. El archivo está ignorado por Git. Restringir su acceso a la cuenta local.
5. Ejecutar `npm run deploy -- --secrets-file .env.deploy`. Wrangler cargará ambos valores como secretos en la misma versión. Borrar `.env.deploy` en cuanto el despliegue termine y confirmar que no figure en Git.
6. Confirmar en Cloudflare que aparece el Cron Trigger `* * * * *` y que el Worker no tiene ruta `workers.dev`. Esperar hasta 15 minutos por la propagación del trigger.
7. Comprobar una ejecución en Cron Events o Workers Logs. Debe aparecer `maintenance_complete` y no `maintenance_failed`. Comprobar que las órdenes caducadas se procesan y que las órdenes con pagos inciertos siguen reservadas para revisión.

`wrangler secret put` publica inmediatamente una versión del Worker. Si el Worker ya está activo, coordinar la rotación con Vercel para evitar errores 401.

Alertar si falta una ejecución por tres minutos, se registra `maintenance_failed` o aparece `payment_reconciliation_required`. Cloudflare almacena eventos y logs; la notificación externa requiere configurar una regla de alertas en la cuenta.