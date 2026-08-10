import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  resolve: {
    alias: { "@": `${root}src` },
  },
  test: {
    environment: "node",
    // La integración con PostgreSQL tiene su propia configuración y runner,
    // que crean una base efímera. `npm test` permanece 100 % unitario/sin DB.
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    restoreMocks: true,
  },
})
