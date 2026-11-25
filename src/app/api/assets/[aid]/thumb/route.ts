import { db } from "@/lib/db";
import { boardAndAccess } from "@/lib/boardAccess";

/** Previews are small: anything bigger isn't one. */
const THUMB_MAX_BYTES = 256 * 1024;
const THUMB_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

/** Sniffs the stored preview's type from its first bytes (it is only ever one of THUMB_TYPES). */
function typeOf(b: Uint8Array) {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  return "image/webp";
}

// A picture's small preview, shown when the board is zoomed out. Like the picture itself, the asset id is the capability to see it.
// 404 when the picture has none yet: the board then shrinks the full picture itself (and an editor's board stores the result).
export async function GET(_req: Request, { params }: { params: Promise<{ aid: string }> }) {
  const { aid } = await params;
  const a = await db.asset.findUnique({ where: { id: aid }, select: { thumb: true } });
  if (!a?.thumb) return new Response("No preview", { status: 404, headers: { "cache-control": "no-store" } });
  const data = new Uint8Array(a.thumb);
  return new Response(data, {
    headers: {
      "content-type": typeOf(data),
      "content-length": String(data.length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}

// Stores a picture's preview. Editors of the picture's board only, once per picture (a preview never changes, so it can be cached forever).
export async function PUT(req: Request, { params }: { params: Promise<{ aid: string }> }) {
  const { aid } = await params;
  const meta = await db.asset.findUnique({ where: { id: aid }, select: { boardId: true, mimeType: true } });
  if (!meta || !meta.mimeType.startsWith("image/")) return Response.json({ error: "Not found" }, { status: 404 });
  const r = await boardAndAccess(meta.boardId, new URL(req.url).searchParams.get("share"));
  if (!r?.access.canEdit) return Response.json({ error: "Not allowed" }, { status: 403 });
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!THUMB_TYPES.has(type)) return Response.json({ error: "Previews are WebP, JPEG or PNG" }, { status: 415 });
  const size = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(size) && size > THUMB_MAX_BYTES) return Response.json({ error: "Preview too big" }, { status: 413 });
  const data = Buffer.from(await req.arrayBuffer());
  if (!data.length || data.length > THUMB_MAX_BYTES) return Response.json({ error: "Preview too big" }, { status: 413 });
  await db.asset.updateMany({ where: { id: aid, thumb: null }, data: { thumb: data } });
  return new Response(null, { status: 204 });
}
