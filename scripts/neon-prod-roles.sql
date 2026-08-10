-- Roles de producción en Neon — FDNDA Inscripciones
--
-- Implementa el punto 2 de "Preparación de Neon" (docs/PRODUCTION_RUNBOOK.md):
-- un rol de aplicación y otro de migración con privilegios separados.
--
-- Cómo ejecutarlo
--   1. Conectarse a la base de PRODUCCIÓN con el rol propietario que crea Neon
--      (neondb_owner). El SQL Editor de la consola de Neon sirve; comprobar que
--      el selector de base apunte a fdnda_inscripciones y no a neondb.
--   2. Sustituir los dos marcadores del bloque 1 por contraseñas aleatorias
--      generadas aparte:
--        node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
--      base64url evita los caracteres que habría que codificar en la URL de
--      conexión. El script aborta si detecta los marcadores sin reemplazar.
--   3. Ejecutar el script completo.
--   4. Guardar las contraseñas en el gestor de secretos del hosting y NO
--      commitear este archivo con valores reales.
--
-- Es idempotente y se puede volver a ejecutar: si los roles ya existen, les
-- reasigna la contraseña indicada. Eso lo hace también el procedimiento de
-- rotación.
--
-- Reparto de responsabilidades
--   fdnda_migrate → DDL. Solo lo usa el job de release (DIRECT_DATABASE_URL).
--   fdnda_app     → DML. Lo usa la aplicación (DATABASE_URL, endpoint pooled).

BEGIN;

-- 1) Roles de login -----------------------------------------------------------
-- Único punto del script donde van las contraseñas.
DO $$
DECLARE
  clave_migrate text := 'REEMPLAZAR_PASSWORD_MIGRATE';
  clave_app     text := 'REEMPLAZAR_PASSWORD_APP';
BEGIN
  IF clave_migrate LIKE 'REEMPLAZAR%' OR clave_app LIKE 'REEMPLAZAR%' THEN
    RAISE EXCEPTION
      'Sustituye los marcadores por contraseñas reales antes de ejecutar el script.';
  END IF;
  IF clave_migrate = clave_app THEN
    RAISE EXCEPTION 'Cada rol necesita su propia contraseña.';
  END IF;
  IF length(clave_migrate) < 24 OR length(clave_app) < 24 THEN
    RAISE EXCEPTION 'Usa contraseñas de al menos 24 caracteres.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fdnda_migrate') THEN
    EXECUTE format('ALTER ROLE fdnda_migrate WITH LOGIN PASSWORD %L', clave_migrate);
  ELSE
    EXECUTE format('CREATE ROLE fdnda_migrate LOGIN PASSWORD %L', clave_migrate);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fdnda_app') THEN
    EXECUTE format('ALTER ROLE fdnda_app WITH LOGIN PASSWORD %L', clave_app);
  ELSE
    EXECUTE format('CREATE ROLE fdnda_app LOGIN PASSWORD %L', clave_app);
  END IF;
END
$$;

-- 2) Solo estos roles se conectan a la base -----------------------------------
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO fdnda_migrate, fdnda_app',
    current_database()
  );
END
$$;

-- 3) Esquema public: solo fdnda_migrate crea objetos --------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE          ON SCHEMA public TO fdnda_app;
GRANT USAGE, CREATE  ON SCHEMA public TO fdnda_migrate;

-- 4) Necesario para fijar privilegios por defecto en nombre de fdnda_migrate --
GRANT fdnda_migrate TO CURRENT_USER;

-- 5) Todo lo que cree fdnda_migrate queda utilizable por fdnda_app ------------
-- Sin esto, cada `prisma migrate deploy` dejaría tablas nuevas invisibles para
-- la aplicación hasta correr un GRANT manual.
ALTER DEFAULT PRIVILEGES FOR ROLE fdnda_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fdnda_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fdnda_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fdnda_app;

-- 6) Objetos que ya existieran (re-ejecución del script) ----------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO fdnda_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO fdnda_app;

COMMIT;

-- Comprobación rápida: fdnda_app no debe poder crear objetos.
--   SET ROLE fdnda_app; CREATE TABLE _prueba(id int);  -- debe fallar
--   RESET ROLE;
-- `npm run db:verify-neon` hace esta comprobación de forma automática.
