-- La afiliación anual pasa de ser una cuota única por club/deportista a una
-- cuota POR DISCIPLINA. El backfill no destruye nada: cada afiliación existente
-- se conserva como CLAVADOS y, si estaba ACTIVE, se clona como ARTÍSTICA con
-- cuota 0 (ya estaba cubierta por el pago único del esquema anterior), así
-- ningún club ni deportista pierde un derecho que ya pagó.
--
-- Las PENDING no se clonan a propósito: nunca se pagaron, no hay derecho que
-- preservar, y clonarlas metería ítems de S/ 0 en el carrito de afiliaciones.

-- ==================== TARIFARIO POR DISCIPLINA ====================

-- CreateTable
CREATE TABLE "season_fees" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "clubFee" DECIMAL(10,2) NOT NULL,
    "athleteFee" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "season_fees_seasonId_idx" ON "season_fees"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "season_fees_seasonId_discipline_key" ON "season_fees"("seasonId", "discipline");

-- AddForeignKey
ALTER TABLE "season_fees" ADD CONSTRAINT "season_fees_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: la cuota única de cada temporada pasa a las dos disciplinas que
-- existían. Polo acuático queda sin tarifa hasta que la federación la defina.
INSERT INTO "season_fees" ("id", "seasonId", "discipline", "clubFee", "athleteFee", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    s."id",
    d."discipline"::"Discipline",
    s."clubFee",
    s."athleteFee",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "seasons" s
CROSS JOIN (VALUES ('DIVING'), ('ARTISTIC_SWIMMING')) AS d("discipline");

-- AlterTable
ALTER TABLE "seasons" DROP COLUMN "clubFee",
DROP COLUMN "athleteFee";

-- ==================== AFILIACIÓN DEL CLUB POR DISCIPLINA ====================

-- AlterTable
ALTER TABLE "club_affiliations" ADD COLUMN "discipline" "Discipline";

UPDATE "club_affiliations" SET "discipline" = 'DIVING' WHERE "discipline" IS NULL;

-- El único viejo se suelta ANTES de clonar: (clubId, seasonId) deja de ser
-- único en cuanto una misma dupla existe en más de una disciplina.
-- DropIndex
DROP INDEX "club_affiliations_clubId_seasonId_key";

-- DropIndex
DROP INDEX "club_affiliations_seasonId_status_idx";

-- El clon de artística nace sin activeOrderId: los order_items siguen apuntando
-- a la fila original, así que ninguna orden queda con dos ítems por lo mismo.
INSERT INTO "club_affiliations" ("id", "clubId", "seasonId", "discipline", "status", "fee", "validFrom", "validTo", "paidAt", "activeOrderId", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    ca."clubId",
    ca."seasonId",
    'ARTISTIC_SWIMMING',
    ca."status",
    0,
    ca."validFrom",
    ca."validTo",
    ca."paidAt",
    NULL,
    ca."createdAt",
    CURRENT_TIMESTAMP
FROM "club_affiliations" ca
WHERE ca."discipline" = 'DIVING' AND ca."status" = 'ACTIVE';

ALTER TABLE "club_affiliations" ALTER COLUMN "discipline" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "club_affiliations_clubId_seasonId_discipline_key" ON "club_affiliations"("clubId", "seasonId", "discipline");

-- CreateIndex
CREATE INDEX "club_affiliations_seasonId_discipline_status_idx" ON "club_affiliations"("seasonId", "discipline", "status");

-- ================ AFILIACIÓN DEL DEPORTISTA POR DISCIPLINA ================

-- AlterTable
ALTER TABLE "athlete_affiliations" ADD COLUMN "discipline" "Discipline";

UPDATE "athlete_affiliations" SET "discipline" = 'DIVING' WHERE "discipline" IS NULL;

-- DropIndex
DROP INDEX "athlete_affiliations_athleteId_seasonId_key";

-- DropIndex
DROP INDEX "athlete_affiliations_clubId_seasonId_idx";

-- DropIndex
DROP INDEX "athlete_affiliations_seasonId_status_idx";

INSERT INTO "athlete_affiliations" ("id", "athleteId", "clubId", "seasonId", "discipline", "status", "fee", "validFrom", "validTo", "paidAt", "activeOrderId", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    aa."athleteId",
    aa."clubId",
    aa."seasonId",
    'ARTISTIC_SWIMMING',
    aa."status",
    0,
    aa."validFrom",
    aa."validTo",
    aa."paidAt",
    NULL,
    aa."createdAt",
    CURRENT_TIMESTAMP
FROM "athlete_affiliations" aa
WHERE aa."discipline" = 'DIVING' AND aa."status" = 'ACTIVE';

ALTER TABLE "athlete_affiliations" ALTER COLUMN "discipline" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "athlete_affiliations_athleteId_seasonId_discipline_key" ON "athlete_affiliations"("athleteId", "seasonId", "discipline");

-- CreateIndex
CREATE INDEX "athlete_affiliations_clubId_seasonId_discipline_idx" ON "athlete_affiliations"("clubId", "seasonId", "discipline");

-- CreateIndex
CREATE INDEX "athlete_affiliations_seasonId_discipline_status_idx" ON "athlete_affiliations"("seasonId", "discipline", "status");

-- ==================== DISCIPLINAS DEL DEPORTISTA ====================

-- AlterTable
ALTER TABLE "athletes" ADD COLUMN "disciplines" "Discipline"[];

-- Coherente con el clonado de arriba: quien ya estaba en el padrón queda
-- registrado en las dos disciplinas que existían antes de polo acuático.
UPDATE "athletes" SET "disciplines" = ARRAY['DIVING', 'ARTISTIC_SWIMMING']::"Discipline"[];
