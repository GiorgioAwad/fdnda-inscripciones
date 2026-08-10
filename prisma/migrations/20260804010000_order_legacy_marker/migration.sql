-- Marca durablemente órdenes históricas incompatibles con la regla actual de
-- una sola competencia por orden. Es aditivo y no altera importes ni estados.
ALTER TABLE "orders"
ADD COLUMN "isLegacy" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "orders_isLegacy_idx" ON "orders"("isLegacy");
