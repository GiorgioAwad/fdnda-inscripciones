-- Revocación inmediata de sesiones tras cambios de credenciales.
ALTER TABLE "users"
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "athletes"
ADD COLUMN "privacyNoticeVersion" TEXT,
ADD COLUMN "privacyAcceptedAt" TIMESTAMP(3),
ADD COLUMN "privacyAcceptedByUserId" TEXT;

CREATE TYPE "PaymentAttemptStatus" AS ENUM (
  'CREATED',
  'SESSION_READY',
  'APPROVED',
  'REJECTED',
  'ERROR'
);

CREATE TABLE "payment_attempts" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerOrderNumber" TEXT NOT NULL,
  "providerTransactionId" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
  "providerResponse" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_events" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "attemptId" TEXT,
  "provider" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "providerTransactionId" TEXT,
  "validSignature" BOOLEAN NOT NULL,
  "amount" DECIMAL(10,2),
  "currency" TEXT,
  "payload" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorRole" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "ipHash" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_rate_limits" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "blockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_rate_limits_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "payment_attempts_provider_providerTransactionId_key"
ON "payment_attempts"("provider", "providerTransactionId");
CREATE INDEX "payment_attempts_provider_providerOrderNumber_idx"
ON "payment_attempts"("provider", "providerOrderNumber");
CREATE INDEX "payment_attempts_orderId_status_idx"
ON "payment_attempts"("orderId", "status");

CREATE UNIQUE INDEX "payment_events_provider_eventKey_key"
ON "payment_events"("provider", "eventKey");
CREATE INDEX "payment_events_orderId_receivedAt_idx"
ON "payment_events"("orderId", "receivedAt");
CREATE INDEX "payment_events_providerTransactionId_idx"
ON "payment_events"("providerTransactionId");

CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");
CREATE INDEX "security_rate_limits_updatedAt_idx" ON "security_rate_limits"("updatedAt");

ALTER TABLE "payment_attempts"
ADD CONSTRAINT "payment_attempts_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_events"
ADD CONSTRAINT "payment_events_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_events"
ADD CONSTRAINT "payment_events_attemptId_fkey"
FOREIGN KEY ("attemptId") REFERENCES "payment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- La restricción histórica se creó NOT VALID para no bloquear el rollout.
-- En una base nueva es seguro validarla; en una base existente, migrate deploy
-- se detendrá si encuentra datos inconsistentes en vez de ocultarlos.
ALTER TABLE "order_items"
VALIDATE CONSTRAINT "order_items_exactly_one_target_check";

-- Solo puede existir una temporada vigente.
CREATE UNIQUE INDEX "seasons_only_one_current_key"
ON "seasons" (("isCurrent"))
WHERE "isCurrent" = true;

-- Acelera el lote de expiración y lo vuelve determinista.
CREATE INDEX "orders_status_expiresAt_id_idx"
ON "orders"("status", "expiresAt", "id");
