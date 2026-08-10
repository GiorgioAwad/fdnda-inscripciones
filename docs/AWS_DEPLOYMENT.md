# Despliegue en AWS

## Opción recomendada dentro de AWS

Para esta aplicación, la entrada más simple es **AWS App Runner** usando la imagen
del `Dockerfile` y Neon como PostgreSQL externo. App Runner entrega una URL HTTPS
propia, escalado administrado, logs y dominio personalizado con certificado ACM.

App Runner no está disponible actualmente en São Paulo. Para App Runner se debe
medir `us-east-1` y colocar Neon en la misma región. Si el requisito principal es
ejecutar en São Paulo, usar ECS/Fargate con Application Load Balancer y ACM, a
cambio de mayor coste y administración.

## Coste y HTTPS

- AWS no es gratis de forma permanente para este servicio. App Runner cobra
  memoria provisionada incluso cuando la instancia está inactiva, más CPU al
  atender solicitudes y otros consumos.
- Las cuentas nuevas pueden tener créditos Free Tier por tiempo limitado. No se
  debe basar el presupuesto de producción en esos créditos.
- La URL `*.awsapprunner.com` ya usa HTTPS.
- Un dominio propio también puede usar HTTPS administrado por App Runner/ACM sin
  comprar un certificado aparte, pero el dominio y el DNS sí cuestan.
- Route 53 cobra el registro anual del dominio y normalmente USD 0,50/mes por la
  zona pública, además de consultas que no sean alias exentos.
- EventBridge Scheduler incluye 14 millones de invocaciones mensuales gratuitas;
  una tarea por minuto usa unas 44.640 al mes. El destino HTTP/API puede tener
  cargos adicionales pequeños.

Crear un AWS Budget y alarmas de facturación antes de desplegar. Fijar también el
máximo de instancias de App Runner.

Documentación oficial:

- https://aws.amazon.com/apprunner/pricing/
- https://docs.aws.amazon.com/apprunner/latest/dg/manage-custom-domains.html
- https://docs.aws.amazon.com/general/latest/gr/apprunner.html
- https://aws.amazon.com/route53/pricing/
- https://aws.amazon.com/eventbridge/pricing/
- https://aws.amazon.com/free/

## Componentes

1. Repositorio Git privado y CI verde.
2. ECR privado con escaneo de imágenes.
3. App Runner, 1 vCPU/2 GB como punto inicial, puerto 3000.
4. Neon pooled/direct en `us-east-1` si se usa App Runner allí.
5. Secrets Manager o SSM Parameter Store SecureString.
6. Route 53 o el DNS existente para el dominio.
7. EventBridge Scheduler para mantenimiento cada minuto.
8. CloudWatch Logs, métricas, alarmas y AWS Budget.

No hace falta ElastiCache/Redis. Los locks, cupos y rate limiting ya son
distribuidos mediante PostgreSQL.

## Construcción y publicación

El pipeline de release debe etiquetar la imagen con el SHA del commit:

```bash
docker build --pull -t fdnda-inscripciones:<git-sha> .
docker run --rm -p 3000:3000 --env-file .env.production fdnda-inscripciones:<git-sha>
```

Probar `/api/health/live` y `/api/health/ready`, publicar la imagen en ECR y crear
App Runner desde esa imagen. En App Runner:

- puerto: `3000`;
- health check HTTP: `/api/health/live`;
- despliegue automático: desactivado para producción; promover el SHA aprobado;
- autoscaling: máximo bajo al inicio para controlar coste y conexiones;
- logs: CloudWatch con retención explícita;
- secretos: referencias ARN, nunca texto plano.

App Runner lee los secretos al desplegar. Después de rotarlos hay que crear un
nuevo despliegue. El rol de instancia solo necesita leer los ARN concretos.

## Base y migraciones

No ejecutar migraciones desde cada réplica. Un job de release único usa
`DIRECT_DATABASE_URL` y ejecuta:

```bash
npm ci
npm run db:migrate:deploy
npm run production:preflight
```

Después se despliega la imagen. `DATABASE_URL` de App Runner siempre debe ser la
URL pooled. Crear snapshot/rama Neon antes de migrar y conservar la imagen
anterior para rollback.

## Dominio e Izipay

1. Comprar o transferir el dominio.
2. Asociarlo en App Runner. Con Route 53, App Runner puede crear los registros de
   validación y enlace; con otro DNS se copian los CNAME indicados.
3. Esperar certificado válido y forzar URL canónica HTTPS.
4. Configurar `NEXT_PUBLIC_APP_URL=https://dominio` y redesplegar.
5. Registrar en Izipay:
   - `https://dominio/api/payments/izipay/webhook`
   - las URL de validación/retorno que genere la integración.
6. Realizar un pago controlado real antes de abrir a clubes.

Cloudflare no es necesario delante de App Runner para obtener HTTPS. Puede
usarse como DNS/WAF por una necesidad concreta, evitando desafíos o caché en
`/api/payments/*`, `/api/auth/*`, `/admin/*` y el portal autenticado.

## Scheduler

Crear una programación `rate(1 minute)` que invoque por HTTPS:

```text
POST https://dominio/api/internal/maintenance/expire-orders
Authorization: Bearer <MAINTENANCE_SECRET>
```

Configurar reintentos limitados y una DLQ/alarma. Alertar si no hay ejecución en
tres minutos, si la respuesta no es 2xx o si
`ordersRequiringPaymentReview > 0`. El secreto debe vivir en Secrets Manager o
en la conexión segura del destino, no en el repositorio.

## Salida a producción

Seguir `docs/PRODUCTION_RUNBOOK.md`. AWS solo resuelve la capa de ejecución y
HTTPS; no reemplaza los pasos de Izipay, privacidad, backups/restauración,
monitoreo, entrega de credenciales ni pruebas de aceptación.
