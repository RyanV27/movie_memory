import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env.local for the Prisma CLI.
dotenv.config({ path: path.resolve(".env.local") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
