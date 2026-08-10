-- Planillas persistentes para el flujo Deportistas -> Competencia ->
-- Pruebas/Formaciones -> Validación y pago. La migración es deliberadamente
-- aditiva: los vínculos con datos históricos permanecen nullable durante el
-- rollout y se completan con scripts/backfill-registration-plans.ts.

-- CreateEnum
CREATE TYPE "RegistrationPlanStatus" AS ENUM (
    'DRAFT',
    'AWAITING_PAYMENT',
    'PAID',
    'ABANDONED'
);

-- AlterTable
ALTER TABLE "events"
ADD COLUMN "seasonId" TEXT;

-- AlterTable
ALTER TABLE "event_modalities"
ADD COLUMN "categoryUpgradeBirthYear" INTEGER;

-- AlterTable
ALTER TABLE "registrations"
ADD COLUMN "planId" TEXT;

-- AlterTable
ALTER TABLE "orders"
ADD COLUMN "registrationPlanId" TEXT,
ADD COLUMN "eventId" TEXT;

-- AlterTable
ALTER TABLE "order_items"
ADD COLUMN "registrationSnapshot" JSONB;

-- CreateTable
CREATE TABLE "registration_plans" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "eventId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" "RegistrationPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registration_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_plan_athletes" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_plan_athletes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_seasonId_idx" ON "events"("seasonId");

-- CreateIndex
CREATE INDEX "registrations_planId_idx" ON "registrations"("planId");

-- CreateIndex
CREATE INDEX "registration_plans_clubId_status_idx"
ON "registration_plans"("clubId", "status");

-- CreateIndex
CREATE INDEX "registration_plans_eventId_status_idx"
ON "registration_plans"("eventId", "status");

-- CreateIndex
CREATE INDEX "registration_plans_createdById_idx"
ON "registration_plans"("createdById");

-- Solo puede existir un borrador/checkout activo sin competencia por club.
-- Los estados terminales no participan y permiten crear suplementos.
CREATE UNIQUE INDEX "registration_plans_one_active_without_event_per_club"
ON "registration_plans"("clubId")
WHERE "eventId" IS NULL
  AND "status" IN ('DRAFT', 'AWAITING_PAYMENT');

-- Solo puede existir un borrador/checkout activo por club y competencia.
CREATE UNIQUE INDEX "registration_plans_one_active_per_club_event"
ON "registration_plans"("clubId", "eventId")
WHERE "eventId" IS NOT NULL
  AND "status" IN ('DRAFT', 'AWAITING_PAYMENT');

-- CreateIndex
CREATE UNIQUE INDEX "registration_plan_athletes_planId_athleteId_key"
ON "registration_plan_athletes"("planId", "athleteId");

-- CreateIndex
CREATE INDEX "registration_plan_athletes_athleteId_idx"
ON "registration_plan_athletes"("athleteId");

-- CreateIndex
CREATE INDEX "orders_registrationPlanId_idx"
ON "orders"("registrationPlanId");

-- CreateIndex
CREATE INDEX "orders_eventId_idx" ON "orders"("eventId");

-- El CHECK nace NOT VALID para que el despliegue del esquema no falle por
-- configuraciones legadas. Ya protege escrituras nuevas; el backfill corrige
-- las filas antiguas y luego lo valida sin reescribir la tabla.
ALTER TABLE "event_modalities"
ADD CONSTRAINT "event_modalities_category_upgrade_artistic_check"
CHECK (
    "discipline" = 'ARTISTIC_SWIMMING'
    OR (
        "allowsCategoryUpgrade" = false
        AND "categoryUpgradeBirthYear" IS NULL
    )
) NOT VALID;

-- AddForeignKey
ALTER TABLE "events"
ADD CONSTRAINT "events_seasonId_fkey"
FOREIGN KEY ("seasonId") REFERENCES "seasons"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_plans"
ADD CONSTRAINT "registration_plans_clubId_fkey"
FOREIGN KEY ("clubId") REFERENCES "clubs"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_plans"
ADD CONSTRAINT "registration_plans_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_plans"
ADD CONSTRAINT "registration_plans_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_plan_athletes"
ADD CONSTRAINT "registration_plan_athletes_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "registration_plans"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_plan_athletes"
ADD CONSTRAINT "registration_plan_athletes_athleteId_fkey"
FOREIGN KEY ("athleteId") REFERENCES "athletes"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations"
ADD CONSTRAINT "registrations_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "registration_plans"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders"
ADD CONSTRAINT "orders_registrationPlanId_fkey"
FOREIGN KEY ("registrationPlanId") REFERENCES "registration_plans"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders"
ADD CONSTRAINT "orders_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "events"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
