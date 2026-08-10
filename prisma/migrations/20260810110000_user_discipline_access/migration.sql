-- Los usuarios existentes conservan acceso coordinador (array vacío). Los
-- nuevos accesos por sección guardan explícitamente sus disciplinas permitidas.
ALTER TABLE "users"
ADD COLUMN "disciplineAccess" "Discipline"[] NOT NULL DEFAULT ARRAY[]::"Discipline"[];
