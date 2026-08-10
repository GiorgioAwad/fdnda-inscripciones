import { createRequire } from "module";
import { defineConfig } from "prisma/config";

const require = createRequire(import.meta.url);

try {
  require("dotenv/config");
} catch {
  // Production containers inject env vars directly.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Runtime usa DATABASE_URL (pooled). Migraciones, backups e importadores
    // usan la conexión directa para no pasar por PgBouncer.
    url: process.env["DIRECT_DATABASE_URL"] || process.env["DATABASE_URL"],
    // Base efímera que Migrate usa para validar el historial y para `migrate
    // diff --from-migrations`. env.example ya la documenta; sin esta línea la
    // variable quedaba sin conectar.
    shadowDatabaseUrl: process.env["PRISMA_MIGRATE_SHADOW_DATABASE_URL"],
  },
});
