ALTER TABLE "registration_plans"
ADD COLUMN "disciplineScope" "Discipline";

DROP INDEX IF EXISTS "registration_plans_one_active_without_event_per_club";
DROP INDEX IF EXISTS "registration_plans_one_active_per_club_event";

-- Coordinador: conserva el comportamiento histórico.
CREATE UNIQUE INDEX "registration_plans_one_coordinator_without_event_per_club"
ON "registration_plans"("clubId")
WHERE "eventId" IS NULL
  AND "disciplineScope" IS NULL
  AND "status" IN ('DRAFT', 'AWAITING_PAYMENT');

CREATE UNIQUE INDEX "registration_plans_one_coordinator_per_club_event"
ON "registration_plans"("clubId", "eventId")
WHERE "eventId" IS NOT NULL
  AND "disciplineScope" IS NULL
  AND "status" IN ('DRAFT', 'AWAITING_PAYMENT');

-- Secciones: Polo y Artística pueden trabajar simultáneamente en el mismo evento.
CREATE UNIQUE INDEX "registration_plans_one_section_without_event_per_club"
ON "registration_plans"("clubId", "disciplineScope")
WHERE "eventId" IS NULL
  AND "disciplineScope" IS NOT NULL
  AND "status" IN ('DRAFT', 'AWAITING_PAYMENT');

CREATE UNIQUE INDEX "registration_plans_one_section_per_club_event"
ON "registration_plans"("clubId", "eventId", "disciplineScope")
WHERE "eventId" IS NOT NULL
  AND "disciplineScope" IS NOT NULL
  AND "status" IN ('DRAFT', 'AWAITING_PAYMENT');

CREATE INDEX "registration_plans_club_discipline_status_idx"
ON "registration_plans"("clubId", "disciplineScope", "status");
