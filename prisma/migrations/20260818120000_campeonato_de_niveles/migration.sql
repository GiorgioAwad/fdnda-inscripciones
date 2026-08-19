-- Campeonato de niveles de natacion artistica: basico, intermedio y avanzado
-- compiten el mismo dia con categorias por edad propias.

-- CreateEnum
CREATE TYPE "ArtisticLevel" AS ENUM ('BASICO', 'INTERMEDIO', 'AVANZADO');

-- La bandera nace en false: ningun evento existente cambia de formato.
ALTER TABLE "events"
  ADD COLUMN "isLevelChampionship" BOOLEAN NOT NULL DEFAULT false;

-- Nulo fuera de un campeonato de niveles, que es todo lo que existe hoy.
ALTER TABLE "event_modalities"
  ADD COLUMN "level" "ArtisticLevel";

-- El nivel pertenece exclusivamente a natacion artistica, igual que "sube de
-- categoria". Nace NOT VALID por la misma razon que aquel: el despliegue del
-- esquema no puede fallar por filas legadas. Como la columna arranca en NULL
-- en todas, la validacion es inmediata y no reescribe la tabla.
ALTER TABLE "event_modalities"
ADD CONSTRAINT "event_modalities_level_artistic_check"
CHECK (
    "discipline" = 'ARTISTIC_SWIMMING'
    OR "level" IS NULL
) NOT VALID;

ALTER TABLE "event_modalities"
VALIDATE CONSTRAINT "event_modalities_level_artistic_check";
