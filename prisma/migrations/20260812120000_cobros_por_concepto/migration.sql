-- Dos conceptos de cobro independientes en vez de un modo excluyente.
ALTER TABLE "event_discipline_configs"
  ADD COLUMN "chargesEntry"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "chargesAthleteFee" BOOLEAN NOT NULL DEFAULT false;

-- Backfill desde el modo excluyente. Los eventos SIN fila no necesitan nada:
-- el default de las columnas es exactamente su comportamiento historico.
UPDATE "event_discipline_configs" SET
  "chargesEntry"      = ("pricingMode" = 'PER_ENTRY'),
  "chargesAthleteFee" = ("pricingMode" = 'PER_ATHLETE');

-- Que conceptos eligio pagar el club en cada planilla.
ALTER TABLE "registration_plans"
  ADD COLUMN "paysEntry"      BOOLEAN,
  ADD COLUMN "paysAthleteFee" BOOLEAN;
