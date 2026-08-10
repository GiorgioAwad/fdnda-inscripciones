# Pruebas de pago con Izipay (sandbox)

Cómo ejecutar un pago real de punta a punta contra el entorno de pruebas de
Izipay, en tu máquina.

El flujo implementado es **Web Core en modo pop-up**: el SDK monta un iframe
superpuesto (`allow="payment *"`) y el club nunca sale del portal — no es una
ventana del navegador, así que el bloqueador de pop-ups no lo afecta.

El resultado vuelve por dos caminos independientes:

| Camino | Quién lo dispara | Ruta |
|---|---|---|
| **Primario** | `callbackResponse` del SDK, en el navegador | `POST /api/payments/izipay/validate` |
| **Respaldo** | Izipay, servidor a servidor | `POST /api/payments/izipay/webhook` (IPN) |

Ambos verifican la firma HMAC y son idempotentes, así que da igual cuál llegue
primero o si llegan los dos. `redirect-result` sigue montada porque Izipay puede
degradar a redirect por su cuenta.

**Un rechazo no mata la orden.** Como el club se quedó en la página, una tarjeta
declinada deja la orden `PENDING` para que reintente con otra sin rearmar la
planilla ni perder sus cupos. Si abandona, expira sola a los 30 minutos.

## 1. Configuración

El `.env` ya trae las credenciales **sandbox** del comercio `4004353`, las mismas
que usa el proyecto de ticketing. No sirven en producción.

```
PAYMENTS_MODE=izipay
IZIPAY_MERCHANT_CODE=4004353
IZIPAY_API_KEY=…          # clave API del Nuevo Botón de Pagos
IZIPAY_HASH_KEY=…         # clave de firma HMAC-SHA256
IZIPAY_PUBLIC_KEY=…       # keyRSA que consume el SDK del navegador
IZIPAY_ENDPOINT=https://sandbox-api-pw.izipay.pe
```

La URL del SDK se deriva sola de `IZIPAY_ENDPOINT`: si contiene `sandbox`, se usa
`sandbox-checkout.izipay.pe`; si no, `checkout.izipay.pe`
(`src/lib/izipay.ts`). No hay que configurarla.

Con `PAYMENTS_MODE=izipay` el panel de pago simulado deja de renderizarse. Para
volver a él, `PAYMENTS_MODE=mock` y reiniciar el dev server.

## 2. Túnel público — recomendado, ya no imprescindible

En pop-up la confirmación primaria la hace **el navegador contra nuestro propio
servidor** (`/validate`), así que el camino feliz funciona en `localhost` sin
túnel. Lo que el túnel habilita es el **respaldo**:

- `urlIPN` → `POST /api/payments/izipay/webhook`, **servidor a servidor**. Con
  `localhost` no llega nunca: si el callback del SDK falla, la orden se queda
  `PENDING` hasta expirar y nadie la rescata.
- `redirectUrls` → `/api/payments/izipay/redirect-result`, por si Izipay degrada
  a redirect. Su página es HTTPS y publicar hacia `http://localhost` es contenido
  mixto que el navegador bloquea.

Como en producción el IPN es la red de seguridad, **conviene probar con túnel al
menos una vez** para verificar que llega y confirma. Para iterar en la UI del
checkout, `localhost` basta.

```powershell
ngrok http 3000
```

Copia el host que imprime (`abc123.ngrok-free.app`) a **las dos** variables:

```
NEXT_PUBLIC_APP_URL=https://abc123.ngrok-free.app
DEV_TUNNEL_HOST=abc123.ngrok-free.app
```

`DEV_TUNNEL_HOST` alimenta `allowedDevOrigins` y `serverActions.allowedOrigins`
en `next.config.ts`. Sin él Next rechaza las server actions por cross-origin y
los botones del carrito quedan inertes.

**Reinicia `npm run dev`** después de editar el `.env`: las `NEXT_PUBLIC_*` y
`next.config.ts` se leen al arrancar. En el plan gratuito de ngrok el host cambia
en cada arranque, así que hay que repetir este paso cada vez.

## 3. Comprobar la infraestructura antes de pagar

Con el dev server arriba (sustituye el host por `localhost:3000` si no usas
túnel):

```powershell
# Health check del IPN — Izipay hace este GET al registrar la URL
curl.exe https://abc123.ngrok-free.app/api/payments/izipay/webhook
# → {"endpoint":"izipay-webhook","accepts":[...]}

# Proxy del SDK — debe devolver JavaScript, no una página de error
curl.exe -I https://abc123.ngrok-free.app/api/checkout/runtime
# → 200, Content-Type: application/javascript
```

Si `/api/checkout/runtime` devuelve 502, el checkout todavía funciona (el cliente
cae al CDN de Izipay), pero un bloqueador de anuncios podrá romperlo.

## 4. Ejecutar el pago

1. Entra al portal **por la URL del túnel**, no por `localhost` (si no, las URLs
   de retorno apuntan a un origen distinto del que abrió el pago).
2. Login como club → arma una planilla con costo mayor a S/ 0 → checkout.
3. En `/pago/[orderId]` pulsa **Pagar con Izipay**. El módulo de pago se abre
   sobre la misma página.
4. Paga con una tarjeta de prueba (ver abajo). Al cerrarse el módulo, el callback
   del SDK confirma contra `/validate` y la página pasa a la constancia de pago.
5. Además, la página se refresca sola cada 5 s mientras la orden está `PENDING`,
   así que si el callback no llegara, el IPN igual la confirma sin que haga falta
   recargar ni volver a pagar.

### Tarjetas de prueba

**No están en este repositorio a propósito.** Se obtienen del Back Office sandbox
de Izipay o del portal `developers.izipay.pe`, y cambian según el comercio.
Como este proyecto usa el mismo comercio sandbox que el ticketing (`4004353`),
sirven exactamente las mismas tarjetas que ya se usan allí.

Necesitas al menos dos: una que **aprueba** y una que **rechaza**, para cubrir
los dos caminos de la sección 5.

## 5. Qué verificar

**Pago aprobado**

- Log del servidor: `[izipay/session]` **sin** la línea «config con parámetros
  fuera de regla». Si aparece, Izipay puede rechazar el config antes de abrir el
  checkout; el detalle dice qué campo y qué longitud esperaba.
- La orden queda `PAID` en `npm run db:studio`, con `paidAt`, `provider="IZIPAY"`,
  `providerRef`, `providerTransactionId` y `providerResponse` poblados.
- `Registration` → `PAID`, `RegistrationPlan` → `PAID`, y las afiliaciones que
  cubriera la orden → `ACTIVE`.

**Pago rechazado**

- La orden sigue `PENDING` y el botón vuelve a estar disponible con el mensaje de
  Izipay. Es deliberado: en pop-up lo natural es reintentar con otra tarjeta.
- Comprueba que un segundo intento con una tarjeta válida sí confirma la misma
  orden.

**Idempotencia**

- Es normal que lleguen `/validate` **y** el IPN para el mismo pago. La
  confirmación se aplica una sola vez: el `updateMany` filtra por
  `status: "PENDING"` y la segunda pasada sale sin efecto
  (`fulfillPaidOrder` en `src/lib/orders.ts`).

## 6. Problemas frecuentes

| Síntoma | Causa |
|---|---|
| El módulo no abre y aparece un mensaje de Izipay | El SDK rechazó el config. Revisa las violaciones que loguea `/api/payments/izipay/session`. |
| «No pudimos cargar el módulo de pago» | Fallaron el proxy propio **y** el CDN. El mensaje incluye el motivo de cada intento. |
| El módulo abre pero la página no pasa a `PAID` | El callback no confirmó. Revisa `[izipay/validate]` en los logs; el IPN debería confirmarla en segundos igualmente. |
| La orden se queda `PENDING` para siempre | Falló el callback **y** el IPN no llega: `NEXT_PUBLIC_APP_URL` apunta a `localhost` o el túnel se cayó. |
| «La firma de Izipay no es válida» | `IZIPAY_HASH_KEY` no corresponde al comercio de `IZIPAY_MERCHANT_CODE`. |
| Los botones del carrito no responden detrás del túnel | Falta `DEV_TUNNEL_HOST`, o no se reinició el dev server tras ponerlo. |
| La orden expiró mientras probabas | Son 30 minutos (`ORDER_EXPIRATION_MINUTES`). Vuelve a hacer checkout. |

## Limitación conocida: documento del comprador

`resolveIzipayDocument(null)` en `src/lib/izipay-config.ts` siempre envía
`documentType: "OTROS"` y `document: "00000000"`, porque el modelo `Club` no
guarda RUC ni DNI. Es válido para Web Core y suficiente en sandbox. Enviar el
documento real exige agregar el campo al modelo y pedirlo en el portal — lo
primero a tocar si algún día se requiere emitir comprobante.
