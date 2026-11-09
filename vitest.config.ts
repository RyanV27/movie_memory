import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Load .env.local (tests use the dev database).
dotenv.config({ path: path.resolve(".env.local") });

export default defineConfig({
  resolve: { alias: { "@": path.resolve(".") } },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "test_helpers/**", ".next/**", "temp/**"],
    passWithNoTests: true,
    // One file at a time: cleanup deletes all test users.
    fileParallelism: false,
    globalSetup: ["./test_helpers/global-setup.ts"],
  },
});
