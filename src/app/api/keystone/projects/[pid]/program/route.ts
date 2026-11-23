import { NextResponse } from "next/server";
import { keystoneFetch } from "@/lib/keystoneAuth";
import { keystoneFailure, keystonePage, sendContext } from "@/lib/keystoneSend";

const MAX_CSV = 512 * 1024;

/**
 * A bubble diagram's room program and adjacency matrix (Keystone's CSV format) made the Keystone project's room program.
 * JSON { boardId, program, adjacency }. Answers { rooms, relations, url } (url: the project's program in Keystone).
 */
export async function POST(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const body = (await req.json().catch(() => null)) as { boardId?: string; program?: string; adjacency?: string } | null;
  const ctx = await sendContext(pid, String(body?.boardId ?? ""));
  if ("error" in ctx) return ctx.error;
  const program = String(body?.program ?? ""), adjacency = String(body?.adjacency ?? "");
  if (!program.trim()) return NextResponse.json({ error: "The diagram has no rooms" }, { status: 400 });
  if (program.length > MAX_CSV || adjacency.length > MAX_CSV) return NextResponse.json({ error: "The room program is too large" }, { status: 413 });
  try {
    const { json } = await keystoneFetch(ctx.user.id, `/api/projects/${pid}/schema/program`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ program, adjacency, board: ctx.board.title, boardUrl: ctx.boardUrl }),
    });
    const j = (json ?? {}) as { rooms?: number; relations?: number };
    return NextResponse.json({ rooms: j.rooms ?? 0, relations: j.relations ?? 0, url: keystonePage(pid, "massing/import") });
  } catch (x) {
    return keystoneFailure(x);
  }
}
