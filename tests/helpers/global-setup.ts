import { prisma } from "../../lib/prisma";
import { cleanup } from "./cleanup";

// Clears leftover test users before every run.
export default async function setup() {
  await cleanup();
  await prisma.$disconnect();
}
