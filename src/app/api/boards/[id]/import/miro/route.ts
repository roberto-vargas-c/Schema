import { NextResponse } from "next/server";
import { z } from "zod";
import { boardAndAccess } from "@/lib/boardAccess";
import { miroBoardId } from "@/lib/board/miro";
import { MiroError, miroBoardAccess } from "@/lib/miroAuth";
import { readMiroBoard } from "@/lib/miroImport";

const Body = z.object({ link: z.string().min(3).max(500), token: z.string().min(10).max(500).optional() });

/**
 * Imports a Miro board through Miro's REST API, with the person's connected Miro account ("Connect Miro"),
 * or an access token pasted by hand (used for this request only, never stored or logged).
 * Returns elements laid out from (0, 0), and the pictures still to copy (one request each, through
 * ./image); the client places them.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await boardAndAccess(id, new URL(req.url).searchParams.get("share"));
  if (!r?.access.canEdit || !r.user) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add the Miro board link" }, { status: 400 });
  const boardId = miroBoardId(parsed.data.link);
  if (!boardId) return NextResponse.json({ error: "That doesn't look like a Miro board link" }, { status: 400 });
  try {
    const { token, board } = await miroBoardAccess(r.user.id, boardId, parsed.data.token);
    const result = await readMiroBoard(token, boardId);
    return NextResponse.json({ name: board.name ?? "Miro board", miroBoardId: boardId, ...result });
  } catch (e) {
    if (e instanceof MiroError) return NextResponse.json({ error: e.message, needsConnect: e.needsConnect || undefined }, { status: e.status });
    return NextResponse.json({ error: "Couldn't reach Miro. Try again" }, { status: 502 });
  }
}
