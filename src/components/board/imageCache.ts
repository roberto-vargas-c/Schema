"use client";

/**
 * Decoded pictures, shared by every node that shows the same file, so an item scrolled back into view (or a
 * picture used twice) draws at once instead of loading and decoding again. The oldest ones are dropped past
 * a limit so a big board doesn't keep every bitmap in memory.
 */
const IMAGE_CACHE_MAX = 240;
const imageCache = new Map<string, HTMLImageElement>();
const imagePending = new Map<string, Promise<HTMLImageElement | null>>();

function rememberImage(src: string, img: HTMLImageElement) {
  imageCache.delete(src);
  imageCache.set(src, img);
  while (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value as string);
}

/** A picture that has already been loaded, or null. */
export function peekImage(src: string): HTMLImageElement | null {
  const hit = imageCache.get(src);
  if (hit) rememberImage(src, hit);
  return hit ?? null;
}

/** Loads a picture once; null if it fails. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  const hit = peekImage(src);
  if (hit) return Promise.resolve(hit);
  let p = imagePending.get(src);
  if (p) return p;
  p = new Promise<HTMLImageElement | null>((resolve) => {
    const i = new window.Image();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      imagePending.delete(src);
      if (ok) rememberImage(src, i);
      resolve(ok ? i : null);
    };
    i.onload = () => done(true);
    i.onerror = () => done(false);
    i.src = src;
  });
  imagePending.set(src, p);
  return p;
}

// ── Previews ─────────────────────────────────────────────────────────────────
// A zoomed-out board draws each picture from a small preview (longest side THUMB_SIDE) instead of the full file, which
// keeps far less in memory and is much quicker to draw. Pictures uploaded to the board have their preview stored next to
// them (/api/assets/<id>/thumb). When one has none yet, the full picture is shrunk here, and an editor's board stores
// the result so nobody has to do it again.

export const THUMB_SIDE = 512;
/** A picture as the canvas draws it: a loaded file or a shrunk copy. */
export type Picture = HTMLImageElement | HTMLCanvasElement;

const ASSET_URL = /^\/api\/assets\/([0-9a-f]{32})$/;
const THUMB_CACHE_MAX = 1500;
const thumbCache = new Map<string, Picture>();
const thumbPending = new Map<string, Promise<Picture | null>>();
let uploader: ((aid: string, blob: Blob) => Promise<unknown>) | null = null;

/** Lets the board store previews it had to make (editors only); null for people who can't edit. */
export function setThumbUploader(fn: ((aid: string, blob: Blob) => Promise<unknown>) | null) { uploader = fn; }

/** The asset id of a picture uploaded to a board, or null for anything else. */
export function assetIdOf(src: string) { return ASSET_URL.exec(src)?.[1] ?? null; }

function rememberThumb(src: string, t: Picture) {
  thumbCache.delete(src);
  thumbCache.set(src, t);
  while (thumbCache.size > THUMB_CACHE_MAX) thumbCache.delete(thumbCache.keys().next().value as string);
}

export function peekThumb(src: string): Picture | null {
  const hit = thumbCache.get(src);
  if (hit) rememberThumb(src, hit);
  return hit ?? null;
}

/** Draws a picture shrunk to fit THUMB_SIDE; null when it is already that small. */
function shrink(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement | null {
  const k = THUMB_SIDE / Math.max(img.width, img.height);
  if (!(k < 0.8)) return null;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Encodes a preview: WebP (keeps transparency, small), PNG where the browser can't write WebP. */
function encode(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.8)).then((b) =>
    b && b.type === "image/webp" ? b : new Promise<Blob | null>((r) => c.toBlob(r, "image/png")));
}

/** Makes the preview for a picture being uploaded; null when it is small enough not to need one. */
export async function thumbFromBlob(blob: Blob): Promise<Blob | null> {
  if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) return null;
  const bmp = await createImageBitmap(blob);
  try {
    const c = shrink(bmp);
    return c ? await encode(c) : null;
  } finally { bmp.close(); }
}

function loadPlain(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const i = new window.Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
}

/** Loads a picture's preview: the stored one, or else the full picture shrunk here. Null if the picture can't be loaded. */
export function loadThumb(src: string): Promise<Picture | null> {
  const hit = peekThumb(src);
  if (hit) return Promise.resolve(hit);
  let p = thumbPending.get(src);
  if (p) return p;
  p = (async () => {
    const aid = assetIdOf(src);
    const stored = aid ? await loadPlain(`/api/assets/${aid}/thumb`) : null;
    let t: Picture | null = stored;
    if (!t) {
      const full = await loadImage(src);
      if (!full) return null;
      const c = shrink(full);
      t = c ?? full;
      if (c && aid && uploader) {
        const up = uploader;
        encode(c).then((b) => (b ? up(aid, b) : null)).catch(() => { /* someone else can store it */ });
      }
    }
    rememberThumb(src, t);
    return t;
  })().finally(() => thumbPending.delete(src));
  thumbPending.set(src, p);
  return p;
}
