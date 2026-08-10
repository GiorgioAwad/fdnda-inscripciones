-- "Sube de categoría": la prueba admite además a los deportistas del último año
-- de la categoría inmediata inferior (regla de natación artística para Solo,
-- Figuras y Estrellas). Arranca en false: ninguna prueba existente cambia.

-- AlterTable
ALTER TABLE "event_modalities" ADD COLUMN     "allowsCategoryUpgrade" BOOLEAN NOT NULL DEFAULT false;
