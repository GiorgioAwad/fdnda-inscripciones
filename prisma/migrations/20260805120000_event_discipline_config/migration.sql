-- Configuración por disciplina dentro de un evento: cómo cobra y cómo interpreta
-- las edades. Los eventos nuevos tienen exactamente una fila (un evento = una
-- disciplina); los eventos legados multidisciplina pueden tener varias.
--
-- No se hace backfill a propósito: AUSENCIA DE FILA significa PER_ENTRY + RANGE,
-- así que todos los eventos anteriores conservan exactamente su comportamiento
-- actual (precio por formación, ventana birthYearFrom..birthYearTo).

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('PER_ENTRY', 'PER_ATHLETE');

-- CreateEnum
CREATE TYPE "AgeRuleMode" AS ENUM ('RANGE', 'MAX_AGE_ONLY');

-- CreateTable
CREATE TABLE "event_discipline_configs" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "pricingMode" "PricingMode" NOT NULL DEFAULT 'PER_ENTRY',
    "athleteFee" DECIMAL(10,2),
    "ageRuleMode" "AgeRuleMode" NOT NULL DEFAULT 'RANGE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_discipline_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_discipline_configs_eventId_idx" ON "event_discipline_configs"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_discipline_configs_eventId_discipline_key" ON "event_discipline_configs"("eventId", "discipline");

-- AddForeignKey
ALTER TABLE "event_discipline_configs" ADD CONSTRAINT "event_discipline_configs_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Una cuota fija sin monto no significa nada: PER_ATHLETE exige athleteFee > 0.
-- El admin ya lo valida en saveEvent; esto lo garantiza a nivel de base.
ALTER TABLE "event_discipline_configs" ADD CONSTRAINT "event_discipline_configs_athlete_fee_check"
  CHECK ("pricingMode" <> 'PER_ATHLETE' OR ("athleteFee" IS NOT NULL AND "athleteFee" > 0));
