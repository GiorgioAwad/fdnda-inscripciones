-- Delegados y entrenadores por disciplina de un evento.
--
-- Los topes viven en la configuración de cada disciplina y los define la FDNDA
-- por evento. Los defaults (1 delegado, 3 entrenadores, delegado opcional)
-- habilitan la sección en los eventos existentes sin volver obligatorio nada
-- que un club ya pagó.

-- AlterTable
ALTER TABLE "event_discipline_configs" ADD COLUMN "maxDelegates" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "maxCoaches" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "requiresDelegate" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "event_discipline_configs"
  ADD CONSTRAINT "event_discipline_configs_officials_check"
  CHECK ("maxDelegates" BETWEEN 0 AND 5 AND "maxCoaches" BETWEEN 0 AND 10);

-- CreateEnum
CREATE TYPE "EventOfficialRole" AS ENUM ('DELEGATE', 'COACH');

-- CreateTable
CREATE TABLE "event_officials" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "role" "EventOfficialRole" NOT NULL,
    "firstNames" TEXT NOT NULL,
    "lastNames" TEXT NOT NULL,
    "docType" "DocType" NOT NULL,
    "docNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_officials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_officials_clubId_eventId_idx" ON "event_officials"("clubId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_officials_eventId_clubId_discipline_docType_docNumber_key" ON "event_officials"("eventId", "clubId", "discipline", "docType", "docNumber");

-- AddForeignKey
ALTER TABLE "event_officials" ADD CONSTRAINT "event_officials_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_officials" ADD CONSTRAINT "event_officials_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
