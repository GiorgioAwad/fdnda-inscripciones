-- Cuota fija por deportista (disciplinas con pricingMode = PER_ATHLETE).
--
-- El único (eventId, discipline, athleteId) es la pieza central: garantiza a
-- nivel de base que a un deportista se le cobre UNA sola vez la disciplina en
-- todo el evento, de modo que una planilla suplementaria con más pruebas del
-- mismo deportista no vuelva a cobrarle.
--
-- OrderItem gana su cuarto destino posible; la invariante pasa a ser "exactamente
-- uno de registrationId / clubAffiliationId / athleteAffiliationId /
-- eventAthleteFeeId".

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "eventAthleteFeeId" TEXT;

-- CreateTable
CREATE TABLE "event_athlete_fees" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "athleteId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "planId" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'IN_CART',
    "fee" DECIMAL(10,2) NOT NULL,
    "activeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_athlete_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_athlete_fees_activeOrderId_idx" ON "event_athlete_fees"("activeOrderId");

-- CreateIndex
CREATE INDEX "event_athlete_fees_planId_idx" ON "event_athlete_fees"("planId");

-- CreateIndex
CREATE INDEX "event_athlete_fees_clubId_eventId_discipline_idx" ON "event_athlete_fees"("clubId", "eventId", "discipline");

-- CreateIndex
CREATE UNIQUE INDEX "event_athlete_fees_eventId_discipline_athleteId_key" ON "event_athlete_fees"("eventId", "discipline", "athleteId");

-- CreateIndex
CREATE INDEX "order_items_eventAthleteFeeId_idx" ON "order_items"("eventAthleteFeeId");

-- AddForeignKey
ALTER TABLE "event_athlete_fees" ADD CONSTRAINT "event_athlete_fees_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_athlete_fees" ADD CONSTRAINT "event_athlete_fees_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_athlete_fees" ADD CONSTRAINT "event_athlete_fees_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_athlete_fees" ADD CONSTRAINT "event_athlete_fees_planId_fkey" FOREIGN KEY ("planId") REFERENCES "registration_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_eventAthleteFeeId_fkey" FOREIGN KEY ("eventAthleteFeeId") REFERENCES "event_athlete_fees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariante de OrderItem: exactamente un destino. Nace NOT VALID para no
-- recorrer las órdenes históricas durante el deploy; las filas nuevas sí se
-- verifican desde el primer INSERT.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_exactly_one_target_check"
  CHECK (
    (("registrationId" IS NOT NULL)::int
   + ("clubAffiliationId" IS NOT NULL)::int
   + ("athleteAffiliationId" IS NOT NULL)::int
   + ("eventAthleteFeeId" IS NOT NULL)::int) = 1
  ) NOT VALID;
