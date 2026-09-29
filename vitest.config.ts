import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * The "@" alias mirrors the `paths` mapping in tsconfig.json so tests can
 * import application code the same way the app does.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
