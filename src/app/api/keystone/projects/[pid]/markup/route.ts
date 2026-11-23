import { NextResponse } from "next/server";
import { keystoneFetch } from "@/lib/keystoneAuth";
import { keystoneFailure, keystonePage, sendContext } from "@/lib/keystoneSend";

const MAX_IMAGE = 8 * 1024 * 1024;

/**
 * A marked-up sheet sent back to its Keystone project as a review item. A form: boardId, image (PNG or JPEG of the sheet with
 * its markup), sheet (its name), notes (a JSON list of the notes and verdicts on it). Answers { open, url } (open items in Keystone, and where they are).
 */
export async function POST(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Send a form with the picture" }, { status: 400 }); }
  const ctx = await sendContext(pid, String(form.get("boardId") ?? ""));
  if ("error" in ctx) return ctx.error;
  const image = form.get("image");
  if (!(image instanceof File) || !image.size) return NextResponse.json({ error: "No picture of the sheet" }, { status: 400 });
  if (image.size > MAX_IMAGE) return NextResponse.json({ error: "The picture is larger than 8 MB" }, { status: 413 });
  let notes: string[] = [];
  try { const n = JSON.parse(String(form.get("notes") ?? "[]")); if (Array.isArray(n)) notes = n.map(String).slice(0, 50); } catch { /* none */ }

  const out = new FormData();
  out.append("image", new Blob([await image.arrayBuffer()], { type: image.type === "image/png" ? "image/png" : "image/jpeg" }), image.type === "image/png" ? "markup.png" : "markup.jpg");
  out.append("sheet", String(form.get("sheet") ?? "").slice(0, 160));
  out.append("notes", JSON.stringify(notes));
  out.append("board", ctx.board.title.slice(0, 160));
  out.append("boardUrl", ctx.boardUrl);
  out.append("author", (ctx.user.name || "").slice(0, 120));
  try {
    const { json } = await keystoneFetch(ctx.user.id, `/api/projects/${pid}/schema/markup`, { method: "POST", body: out });
    return NextResponse.json({ open: (json as { open?: number } | null)?.open ?? null, url: keystonePage(pid, "project/team") });
  } catch (x) {
    return keystoneFailure(x);
  }
}
