-- Una liga cobra por partido.
ALTER TABLE "events"
  ADD COLUMN "isLeague" BOOLEAN NOT NULL DEFAULT false;

-- Memoria del calculo del precio del plantel. Nulos fuera de una liga.
ALTER TABLE "event_modalities"
  ADD COLUMN "pricePerMatch"  DECIMAL(10,2),
  ADD COLUMN "matchesPerTeam" INTEGER,
  ADD COLUMN "expectedTeams"  INTEGER;
