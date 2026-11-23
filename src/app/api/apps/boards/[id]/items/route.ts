import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { appCaller, imageSize } from "@/lib/apps";
import { boardAccessForUser } from "@/lib/permissions";
import { dropOnBoard } from "@/lib/boardDrop";
import { DB_MAX_BYTES, mediaBucket } from "@/lib/media";
import { makeElement, type BoardElement, type EmbedElement, type ImageElement } from "@/lib/board/types";
import { audit } from "@/lib/audit";
import { APP_URL } from "@/lib/mail";

const MAX_FILES = 24;
/** How the pictures sit in their frame: rows of up to PER_ROW, each picture ROW_H high (board units). */
const PER_ROW = 3, ROW_H = 900, GAP = 60, PAD = 80, HEAD = 60;

/**
 * For a connected app: puts pictures on a board, in a frame of their own next to what is there (Keystone's "Send to Schema").
 * A form with "title" (the frame's name), one or more "file" (PNG, JPEG or WebP, each with its name as caption) and,
 * optionally, "link" (a page the frame links to, e.g. the live 3D model) with "linkTitle", and "project" / "projectName" (the
 * Keystone project the sheets come from, kept on them so that markup on a sheet can be sent back to it).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await appCaller(req);
  if (!c) return NextResponse.json({ error: "Connect your Schema account again" }, { status: 401 });
  const { id } = await params;
  const board = await db.board.findUnique({ where: { id } });
  if (!board || !(await boardAccessForUser(c.user.id, board)).canEdit) return NextResponse.json({ error: "You can't edit that board" }, { status: 403 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Send a form with the pictures" }, { status: 400 }); }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "No pictures" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `At most ${MAX_FILES} pictures at once` }, { status: 413 });
  const title = String(form.get("title") ?? "").trim().slice(0, 120) || c.app;
  const project = String(form.get("project") ?? "");
  const keystone = /^[a-z0-9][a-z0-9-]{0,63}$/.test(project)
    ? { project, ...(String(form.get("projectName") ?? "").trim() && { projectName: String(form.get("projectName")).trim().slice(0, 120) }) }
    : undefined;

  // read and check every picture before storing any
  const pics: { bytes: Uint8Array; type: string; w: number; h: number; name: string }[] = [];
  for (const f of files) {
    if (f.size > DB_MAX_BYTES) return NextResponse.json({ error: `${f.name}: pictures must be under ${DB_MAX_BYTES / 1024 / 1024} MB` }, { status: 413 });
    const bytes = new Uint8Array(await f.arrayBuffer());
    const size = imageSize(bytes);
    if (!size || size.width < 1 || size.height < 1) return NextResponse.json({ error: `${f.name}: send PNG, JPEG or WebP pictures` }, { status: 415 });
    pics.push({ bytes, type: size.type, w: size.width, h: size.height, name: (f.name || "").replace(/\.(png|jpe?g|webp)$/i, "").slice(0, 120) });
  }

  const bucket = mediaBucket();
  const els: BoardElement[] = [];
  let x = PAD, y = PAD + HEAD, rowW = 0, width = 0;
  for (const [i, p] of pics.entries()) {
    const aid = randomBytes(16).toString("hex");
    if (bucket) {
      await bucket.put(aid, p.bytes, { httpMetadata: { contentType: p.type } });
      await db.asset.create({ data: { id: aid, boardId: id, mimeType: p.type, storage: "r2", size: p.bytes.length }, select: { id: true } });
    } else {
      await db.asset.create({ data: { id: aid, boardId: id, mimeType: p.type, storage: "db", size: p.bytes.length, data: Buffer.from(p.bytes) }, select: { id: true } });
    }
    if (i > 0 && i % PER_ROW === 0) { y += ROW_H + GAP; x = PAD; rowW = 0; }
    const w = (p.w / p.h) * ROW_H;
    const el = makeElement("image", x, y, { width: w, height: ROW_H, fill: "transparent", stroke: "transparent" }) as ImageElement;
    el.src = `/api/assets/${aid}`;
    if (p.name) el.plan = { name: p.name };
    if (keystone) el.meta = { keystone: { ...keystone, ...(p.name && { sheet: p.name }) } };
    els.push(el);
    x += w + GAP; rowW += w + GAP; width = Math.max(width, rowW - GAP);
  }
  let height = y + ROW_H - (PAD + HEAD);
  const link = String(form.get("link") ?? "");
  if (/^https:\/\/[^\s]+$/.test(link) && link.length < 600) {
    const e = makeElement("embed", PAD, y + ROW_H + GAP, { url: link, title: String(form.get("linkTitle") ?? "").slice(0, 200) || undefined, site: new URL(link).host } as Partial<BoardElement>) as EmbedElement;
    els.push(e);
    height += GAP + e.height;
  }
  const frame = makeElement("frame", 0, 0, { width: width + 2 * PAD, height: height + 2 * PAD + HEAD, text: title, ...(keystone && { meta: { keystone } }) });
  const area = await dropOnBoard(id, [frame, ...els]);
  await audit(board.workspaceId, c.user, "board.items_added", { type: "board", id: board.id, name: board.title }, { via: c.app, pictures: pics.length });
  return NextResponse.json({ url: `${APP_URL()}/board/${id}`, added: pics.length, area });
}
