-- Guía de bienvenida: se muestra una sola vez por usuario.
ALTER TABLE "users" ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Quien ya cambió su contraseña temporal ya usó el portal: no es un usuario
-- nuevo y no debe recibir la guía de golpe. Puede abrirla desde el menú.
-- Los usuarios que aún tienen la contraseña temporal nunca entraron y sí la
-- verán en su primer ingreso.
UPDATE "users" SET "onboardedAt" = CURRENT_TIMESTAMP WHERE "mustChangePassword" = false;
