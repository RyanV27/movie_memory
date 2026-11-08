import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Tests run against the dev database: DATABASE_URL comes from .env.local.
dotenv.config({ path: path.resolve(".env.local") });

export default defineConfig({
  resolve: { alias: { "@": path.resolve(".") } },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "tests/**", ".next/**", "temp/**"],
    passWithNoTests: true,
    // The shared cleanup helper deletes all test-domain users (@test.movie-memory.local), so files running at once would delete each other's users.
    fileParallelism: false,
  },
});
