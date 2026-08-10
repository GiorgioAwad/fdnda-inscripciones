# Runbook de producción

## Estado de salida

El código incluye validación estricta de configuración, pagos correlacionados,
rate limiting compartido en PostgreSQL, revocación de sesiones, auditoría,
cabeceras de seguridad, health checks, imagen Docker, migraciones y CI. Aun así,
un despliegue no debe recibir pagos hasta completar todos los controles externos
de esta lista:

- [ ] Repositorio privado con todo el código revisado, commit inicial y rama
  protegida. Nunca incluir `.env`, `.private-imports`, reportes o trazas.
- [ ] Entorno de *staging* separado de producción.
- [ ] Neon de producción con PITR/retención definida y restauración ensayada.
- [ ] Dominio comprado, DNS configurado y HTTPS válido.
- [ ] Comercio Izipay de producción habilitado, IPN registrado y pruebas de
  aprobación, rechazo, doble callback y callback tardío completadas.
- [ ] Procedimiento de consulta de transacciones habilitado por Izipay. La API
  pública de Web Core no documenta una consulta autoritativa; hasta que Izipay
  entregue ese contrato, las órdenes dudosas quedan reservadas para revisión
  manual y no se cancelan automáticamente.
- [ ] Tratamiento de datos personales revisado por asesoría peruana, banco de
  datos personales registrado y código cargado en el entorno.
- [ ] MFA o una segunda barrera de acceso para administradores.
- [ ] Scheduler cada minuto, logs centralizados, alarmas y responsable de guardia.
- [ ] Credenciales de clubes entregadas de forma segura y archivo JSON local
  eliminado o cifrado después de la entrega.

## Arquitectura recomendada

- Aplicación: Vercel, región `iad1`. Ver `docs/VERCEL_DEPLOYMENT.md`. El
  `Dockerfile` se conserva para CI y para probar el modo producción en local.
- Base: Neon PostgreSQL en `us-east-1`. `DATABASE_URL` usa el endpoint *pooled*;
  la tarea de migración usa `DIRECT_DATABASE_URL` directa, que no se carga en el
  hosting web. Ambas con `sslmode=require`.
- Consistencia: PostgreSQL es la fuente de verdad para cupos, pagos y límites.
  Redis no es necesario en el diseño actual.
- Scheduler: invoca cada minuto
  `POST /api/internal/maintenance/expire-orders` con
  `Authorization: Bearer <MAINTENANCE_SECRET>`.
- Observabilidad: recopilar stdout/stderr JSON, comprobar `/api/health/live` y
  `/api/health/ready`, y alertar sobre `payment_reconciliation_required`, errores
  de firma, HTTP 5xx y ausencia de ejecuciones del scheduler.

Aplicación y Neon deben vivir en la misma región. Ambas están en `us-east-1`
(`iad1` en Vercel). Si alguna vez se mueve una, se mueve la otra: una consulta
cruzando regiones penaliza cada paso del checkout.

## Secretos y configuración

Partir de `env.example`. Producción no arranca si falta una variable crítica.
Generar valores independientes para *staging* y producción.

| Variable | Regla de producción |
| --- | --- |
| `DATABASE_URL` | Neon pooled, TLS, usuario de aplicación |
| `DIRECT_DATABASE_URL` | Neon directo, TLS, solo job de migración; nunca en el hosting web |
| `CRON_SECRET` | igual que `MAINTENANCE_SECRET` (lo envía el cron de Vercel) |
| `AUTH_SECRET` | aleatorio, mínimo 32 caracteres |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Base64 de 32 bytes, igual en todas las instancias |
| `PAYMENTS_MODE` | exactamente `izipay` |
| `IZIPAY_*` | credenciales y endpoint reales, nunca sandbox |
| `NEXT_PUBLIC_APP_URL` | URL canónica HTTPS sin ruta |
| `MAINTENANCE_SECRET` | aleatorio, mínimo 32 caracteres |
| `IP_HASH_SECRET` | aleatorio, mínimo 32 caracteres |
| `PRIVACY_CONTACT_EMAIL` | buzón atendido para derechos de titulares |
| `PERSONAL_DATA_BANK_REGISTRATION_CODE` | registro real, no un marcador |

Guardar secretos en el gestor del hosting. No pasarlos como argumentos de shell,
no imprimirlos y no reutilizarlos entre entornos. Rotar de inmediato ante una
exposición. Un cambio de secreto requiere redesplegar todas las instancias.

## Preparación de Neon

1. Crear proyectos o ramas independientes para *staging* y producción.
2. Crear un rol de aplicación y otro de migración con privilegios separados.
3. Activar la retención/PITR que soporte el RPO acordado. Recomendación inicial:
   RPO 15 minutos y RTO 2 horas.
4. Programar además una exportación lógica cifrada diaria fuera del proyecto
   principal; probar restauración trimestralmente.
5. Usar pool máximo 2 por instancia inicialmente y revisar conexiones/latencia.
6. Ejecutar el harness de rendimiento contra *staging* y conservar los p95.

## Procedimiento de release

1. Ejecutar CI con `npm ci`, audit, lint, tipos, Prisma, unitarias, integración,
   migraciones, E2E y build. No continuar con un gate rojo.
2. Crear rama/snapshot de Neon antes de una migración de producción.
3. Con la URL directa ejecutar una sola vez:

   ```bash
   npm run db:migrate:deploy
   npm run production:preflight
   ```

4. Publicar la imagen inmutable identificada por el SHA del commit. No usar
   `latest` como única referencia de rollback.
5. Esperar readiness y comprobar:

   ```text
   GET /api/health/live  -> 200
   GET /api/health/ready -> 200
   ```

6. Probar login admin, login de un club, consulta de deportista, creación de una
   planilla, descarga autorizada y un pago real controlado.
7. Confirmar callback/IPN, monto PEN exacto, una sola orden pagada y una sola
   afectación de cupo. Confirmar que una repetición del callback es idempotente.
8. Verificar la ejecución del scheduler y el dashboard de órdenes.

## Pagos y conciliación

Una orden vencida con un intento `CREATED`, `SESSION_READY`, `APPROVED` o `ERROR` no se
libera: aparece en `/admin/ordenes?review=1`. Para resolverla:

1. Buscar en el portal/soporte de Izipay por comercio, `transactionId` y
   `orderNumber` mostrados en el intento.
2. Comparar estado autorizado, importe exacto y moneda `PEN`.
3. No pedir al club que pague de nuevo mientras exista duda.
4. Si fue autorizada, conservar la evidencia y aplicar el procedimiento de
   cumplimiento manual que Izipay/FDNDA aprueben; si fue rechazada con evidencia
   definitiva, liberar la orden.
5. Registrar actor, evidencia y decisión. Nunca editar directamente el estado sin
   una operación transaccional e idempotente.

Antes del *go-live*, Izipay debe confirmar por escrito el endpoint/contrato de
consulta y las reglas de reintento. Entonces se automatiza esta cola sin cambiar
la regla de seguridad: una respuesta ambigua nunca cancela ni confirma.

## Monitorización y alertas

Alertar al responsable si ocurre cualquiera de estos casos:

- readiness falla dos veces consecutivas;
- el scheduler no se ejecuta durante tres minutos o devuelve no-2xx;
- `ordersRequiringPaymentReview` es mayor que cero;
- aparece una firma Izipay inválida, monto/moneda discordante o transacción no
  reconocida;
- tasa de 5xx o latencia p95 supera el objetivo durante cinco minutos;
- conexiones de PostgreSQL, almacenamiento o CPU superan 80%;
- fallan backup, PITR o prueba de restauración.

Definir retención para logs y auditoría. No incluir DNI, fechas de nacimiento,
contraseñas, PAN, payloads completos de Izipay ni cadenas de conexión.

## Rollback e incidentes

- Código: volver a la imagen del SHA anterior. No revertir una migración con
  `migrate dev` ni borrar columnas durante el incidente.
- Base: para corrupción o borrado, detener escrituras, crear una restauración
  PITR en otro proyecto/rama, validar conteos y luego cambiar la conexión.
- Pagos: deshabilitar nuevas sesiones desde el proveedor o poner la aplicación
  en mantenimiento; conservar callbacks/eventos y conciliar antes de reabrir.
- Credenciales: rotar el secreto afectado, redesplegar, incrementar
  `sessionVersion` de usuarios comprometidos y revisar `audit_logs`.
- Privacidad: preservar evidencia, limitar acceso, evaluar notificación legal y
  documentar alcance, titulares y medidas de contención.

Cada trimestre se debe ensayar restauración, rollback, rotación de secretos y
caída del callback de pagos.
