import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import * as Y from "yjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { atLeast, workspaceRole } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { elementsMap, stateFromElements } from "@/lib/board/doc";
import type { BoardElement } from "@/lib/board/types";
import { MiroError, miroBoardAccess } from "@/lib/miroAuth";
import { readMiroBoard, stackImported } from "@/lib/miroImport";

const Body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("start"), miroBoardId: z.string().min(3).max(200), folderId: z.string().max(40).optional(), teamId: z.string().max(40).optional() }),
  z.object({
    step: z.literal("finish"), boardId: z.string().min(5).max(40),
    elements: z.array(z.object({ id: z.string().min(1).max(80), type: z.string().min(1).max(40) }).passthrough()).max(5000),
  }),
  z.object({ step: z.literal("cancel"), boardId: z.string().min(5).max(40) }),
]);

/**
 * "Migrate from Miro", one Miro board at a time, in steps that each stay well inside Cloudflare's
 * per-request limits:
 *  - start: creates an empty Schema board named after the Miro board, reads the Miro board, and answers
 *    its elements plus the pictures to copy (the client copies each through /api/boards/<id>/import/miro/image);
 *  - finish: saves the elements, with the copied pictures, as the board's content;
 *  - cancel: removes the half-made board when something failed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!atLeast(await workspaceRole(user.id, wid), "MEMBER")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const body = parsed.data;

  if (body.step !== "start") {
    // Only a board this person just created by migrating, and whose content hasn't been filled yet.
    const board = await db.board.findFirst({ where: { id: body.boardId, workspaceId: wid, createdById: user.id }, select: { id: true, title: true, content: true } });
    if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });
    const doc = new Y.Doc();
    if (board.content) Y.applyUpdate(doc, new Uint8Array(board.content));
    const empty = elementsMap(doc).size === 0;
    doc.destroy();
    if (!empty) return NextResponse.json({ error: "That board already has content" }, { status: 409 });
    if (body.step === "cancel") {
      await db.board.delete({ where: { id: board.id } });
      return NextResponse.json({ ok: true });
    }
    await db.board.update({ where: { id: board.id }, data: { content: Buffer.from(stateFromElements(stackImported(body.elements as unknown as BoardElement[]))) } });
    await audit(wid, user, "board.created", { type: "board", id: board.id, name: board.title }, { importedFrom: "miro" });
    return NextResponse.json({ ok: true });
  }

  const { miroBoardId, folderId, teamId } = body;
  if (folderId && !(await db.folder.findFirst({ where: { id: folderId, workspaceId: wid } }))) return NextResponse.json({ error: "Unknown folder" }, { status: 400 });
  if (teamId && !(await db.team.findFirst({ where: { id: teamId, workspaceId: wid } }))) return NextResponse.json({ error: "Unknown team" }, { status: 400 });
  let boardId: string | null = null;
  try {
    const { token, board: miroBoard } = await miroBoardAccess(user.id, miroBoardId);
    const read = await readMiroBoard(token, miroBoardId);
    const title = (miroBoard.name || "Miro board").slice(0, 120);
    // The board exists first so copied pictures can be stored with it; its content comes with "finish".
    const board = await db.board.create({
      data: {
        workspaceId: wid, teamId: teamId || null, folderId: folderId || null, title, createdById: user.id,
        visibility: teamId ? "TEAM" : "WORKSPACE", shareToken: randomBytes(18).toString("base64url"),
        content: Buffer.from(stateFromElements([])),
      },
      select: { id: true },
    });
    boardId = board.id;
    return NextResponse.json({ boardId, title, ...read });
  } catch (e) {
    if (boardId) await db.board.delete({ where: { id: boardId } }).catch(() => {});
    if (e instanceof MiroError) return NextResponse.json({ error: e.message, needsConnect: e.needsConnect || undefined }, { status: e.status });
    console.error("[miro] migrate failed", e);
    return NextResponse.json({ error: "Couldn't reach Miro. Try again" }, { status: 502 });
  }
}
