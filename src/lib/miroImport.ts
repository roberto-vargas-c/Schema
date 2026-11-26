import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { DB_MAX_BYTES, BUCKET_MAX_BYTES, IMAGE_TYPES, mediaBucket } from "./media";
import { mapMiroBoard, type MiroConnector, type MiroItem } from "./board/miro";
import type { BoardElement } from "./board/types";
import { MIRO_API as API, MiroError } from "./miroAuth";

const MAX_ITEMS = 3000;
/** Single-item requests a read may add to the board listing. */
const MAX_EXTRA_REQUESTS = 60;

export type MiroBoardRead = {
  elements: BoardElement[];
  /** Pictures still to copy, one request each (see copyMiroImage): their elements have no src yet. */
  images: { elementId: string; miroUrl: string }[];
  skipped: Record<string, number>;
  /** Items kept as labelled boxes because Miro doesn't share what's in them. */
  placeholders: Record<string, number>;
  truncated: boolean;
};

const miroFetch = (token: string) => async <T,>(path: string): Promise<T> => {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (res.status === 401) throw new MiroError("Miro didn't accept the sign-in. Connect Miro again", 400);
  if (res.status === 403) throw new MiroError("Miro didn't allow reading this board. Make sure you can open it in Miro and the app has boards:read", 400);
  if (res.status === 404) throw new MiroError("Miro couldn't find that board", 400);
  if (res.status === 429) throw new MiroError("Miro is rate-limiting requests. Try again in a minute", 429);
  if (!res.ok) throw new MiroError(`Miro answered ${res.status}`);
  return res.json() as Promise<T>;
};

/**
 * Reads a Miro board's items and connectors through Miro's REST API and maps them to Schema elements,
 * laid out from (0, 0). Pictures aren't copied here: on Cloudflare a request has tight CPU and memory
 * limits, so the caller copies them one per request with copyMiroImage.
 */
export async function readMiroBoard(token: string, miroBoardId: string): Promise<MiroBoardRead> {
  const miro = miroFetch(token);
  const all = async <T,>(path: string): Promise<T[]> => {
    const out: T[] = [];
    let cursor: string | undefined;
    do {
      const page = await miro<{ data: T[]; cursor?: string }>(`${path}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      out.push(...(page.data ?? []));
      cursor = page.cursor || undefined;
    } while (cursor && out.length < MAX_ITEMS);
    return out;
  };
  const b = encodeURIComponent(miroBoardId);
  const [items, connectors] = await Promise.all([all<MiroItem>(`/boards/${b}/items`), all<MiroConnector>(`/boards/${b}/connectors`)]);

  // The board listing leaves some details out; ask for those items one by one (a bounded number, so a
  // big board stays within the server's limits). Failures just leave the item as the listing had it.
  let budget = MAX_EXTRA_REQUESTS;
  const one = async <T,>(path: string): Promise<T | null> => {
    if (budget-- <= 0) return null;
    try { return await miro<T>(path); } catch (e) { if (e instanceof MiroError && e.status === 429) budget = 0; return null; }
  };
  // Embeds: the listing can miss the link and the preview picture.
  const thinEmbeds = items.filter((i) => i.type === "embed" && !i.data?.url && !i.data?.html && !i.data?.previewUrl);
  for (const it of thinEmbeds) {
    const full = await one<MiroItem>(`/boards/${b}/embeds/${encodeURIComponent(it.id)}`);
    if (full?.data) it.data = { ...it.data, ...full.data };
  }
  // Connector ends on items the listing didn't include: where those items are.
  const known = new Set(items.map((i) => i.id));
  const missing = [...new Set(connectors.flatMap((c) => [c.startItem?.id, c.endItem?.id]).filter((id): id is string => !!id && !known.has(id)))];
  const refs: MiroItem[] = [];
  for (const id of missing) {
    const it = (await one<MiroItem>(`/boards/${b}/items/${encodeURIComponent(id)}`)) ?? (await one<MiroItem>(`${API.replace(/\/v2\/?$/, "/v2-experimental")}/boards/${b}/items/${encodeURIComponent(id)}`));
    if (it?.position) refs.push(it);
  }

  const result = mapMiroBoard(items, connectors, { refs });
  return {
    elements: result.elements, images: result.images, skipped: result.skipped, placeholders: result.placeholders, truncated: items.length >= MAX_ITEMS,
  };
}

/** Whether a picture link from Miro's API is one we may send the person's Miro token to. */
export function isMiroResourceUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (process.env.MIRO_API_URL) return u.origin === new URL(process.env.MIRO_API_URL).origin;
    return u.protocol === "https:" && (u.hostname === "api.miro.com" || u.hostname.endsWith(".miro.com"));
  } catch {
    return false;
  }
}

/** Copies one picture from Miro into a Schema board's storage. Answers the element's new src. */
export async function copyMiroImage(token: string, miroUrl: string, schemaBoardId: string): Promise<{ src: string; animated?: boolean }> {
  if (!isMiroResourceUrl(miroUrl)) throw new MiroError("Unexpected picture link from Miro", 400);
  const download = async (format: "original" | "preview") => {
    const u = new URL(miroUrl);
    u.searchParams.set("format", format);
    u.searchParams.set("redirect", "false");
    const { url } = await miroFetch(token)<{ url?: string }>(u.toString());
    if (!url) throw new MiroError("Miro didn't give a download link");
    // Only public https files (the local stand-in used in tests serves http).
    const fileUrl = new URL(url);
    if (!process.env.MIRO_API_URL) {
      if (fileUrl.protocol !== "https:") throw new MiroError("Unexpected download link from Miro");
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(fileUrl.hostname)) throw new MiroError("Unexpected download link from Miro");
    }
    const res = await fetch(fileUrl, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new MiroError(`Miro's file storage answered ${res.status}`);
    return { file: res, type: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() };
  };
  let { file, type } = await download("original");
  if (!IMAGE_TYPES.includes(type)) {
    // SVG and other formats Schema doesn't show: Miro also keeps a rendered preview of every picture.
    await file.body?.cancel().catch(() => {});
    const original = type;
    ({ file, type } = await download("preview"));
    if (!IMAGE_TYPES.includes(type)) throw new MiroError(`Not a picture Schema can show (${original || "unknown type"})`, 422);
  }

  const bucket = mediaBucket();
  const limit = bucket ? BUCKET_MAX_BYTES : DB_MAX_BYTES;
  const declared = Number(file.headers.get("content-length") ?? NaN);
  if (declared > limit) throw new MiroError("The picture is too big to copy", 413);
  const aid = randomBytes(16).toString("hex");
  if (bucket) {
    // Stream straight into object storage when the size is known, so big pictures don't sit in memory.
    const FLS = (globalThis as unknown as { FixedLengthStream?: new (n: number) => TransformStream }).FixedLengthStream;
    let value: ReadableStream | ArrayBuffer, size: number;
    if (FLS && Number.isFinite(declared) && file.body) {
      const fixed = new FLS(declared);
      file.body.pipeTo(fixed.writable).catch(() => {});
      value = fixed.readable; size = declared;
    } else {
      value = await file.arrayBuffer(); size = value.byteLength;
      if (size > limit) throw new MiroError("The picture is too big to copy", 413);
    }
    await bucket.put(aid, value, { httpMetadata: { contentType: type } });
    await db.asset.create({ data: { id: aid, boardId: schemaBoardId, mimeType: type, storage: "r2", size }, select: { id: true } });
  } else {
    const data = Buffer.from(await file.arrayBuffer());
    if (data.length > limit) throw new MiroError("The picture is too big to copy", 413);
    await db.asset.create({ data: { id: aid, boardId: schemaBoardId, mimeType: type, storage: "db", size: data.length, data }, select: { id: true } });
  }
  return { src: `/api/assets/${aid}`, animated: type === "image/gif" || undefined };
}

/** Gives imported elements stacking order: frames behind everything else, in Miro's order. */
export function stackImported(els: BoardElement[]): BoardElement[] {
  const z = Date.now();
  return els.map((x, i) => ({ ...x, z: x.type === "frame" ? z - 1000 + i : z + i }));
}
