import { auth } from "@/auth";
import { createOpenAIFactWriter } from "@/lib/fact/openai-writer";
import { getFact } from "@/lib/fact/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const FAILED = "Couldn't get a movie fact right now.";

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "Not signed in." }, 401);

  try {
    const result = await getFact(userId, { db: prisma, writer: createOpenAIFactWriter() });
    if (result.kind === "no-movie") return json({ error: "No favorite movie set." }, 409);
    // Another request is generating: send the stale Fact (or null) and let the client poll.
    if (result.kind === "pending") return json({ pending: true, fact: result.fact }, 202);
    // AI failed and there is no older Fact: friendly message only.
    if (result.kind === "failed") return json({ error: FAILED }, 503);
    return json({ fact: result.fact, source: result.source }, 200);
  } catch (error) {
    console.error("GET /api/fact failed", error);
    return json({ error: FAILED }, 503);
  }
}
