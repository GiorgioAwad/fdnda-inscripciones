ALTER TABLE "users"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Las claves entregadas previamente a los clubes son temporales. Invalida sus
-- sesiones y obliga a reemplazarlas en el próximo ingreso.
UPDATE "users"
SET "mustChangePassword" = true,
    "sessionVersion" = "sessionVersion" + 1
WHERE "role" = 'CLUB';
