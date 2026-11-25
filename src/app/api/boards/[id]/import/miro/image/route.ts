import { NextResponse } from "next/server";
import { z } from "zod";
import { boardAndAccess } from "@/lib/boardAccess";
import { MiroError, miroBoardAccess } from "@/lib/miroAuth";
import { copyMiroImage } from "@/lib/miroImport";

const Body = z.object({
  board: z.string().min(3).max(200),
  url: z.string().min(10).max(1000),
  token: z.string().min(10).max(500).optional(),
});

/**
 * Copies one picture from a Miro board into this board's storage, for board imports and "Migrate from
 * Miro". One picture per request keeps each request well inside Cloudflare's CPU and memory limits.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await boardAndAccess(id, new URL(req.url).searchParams.get("share"));
  if (!r?.access.canEdit || !r.user) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Missing the Miro board or picture" }, { status: 400 });
  try {
    const { token } = await miroBoardAccess(r.user.id, parsed.data.board, parsed.data.token);
    return NextResponse.json(await copyMiroImage(token, parsed.data.url, id));
  } catch (e) {
    if (e instanceof MiroError) return NextResponse.json({ error: e.message, needsConnect: e.needsConnect || undefined }, { status: e.status });
    return NextResponse.json({ error: "Couldn't copy the picture from Miro" }, { status: 502 });
  }
}
