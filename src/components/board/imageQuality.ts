"use client";

// Upload quality for pictures and PDF pages, chosen per person and remembered in the browser.
export type Quality = "original" | "high" | "medium" | "low";
export const QUALITIES: { id: Quality; label: string; maxSide: number; q: number }[] = [
  { id: "original", label: "Original", maxSide: Infinity, q: 1 },
  { id: "high", label: "High (2560 px)", maxSide: 2560, q: 0.9 },
  { id: "medium", label: "Medium (1600 px)", maxSide: 1600, q: 0.82 },
  { id: "low", label: "Low (1024 px)", maxSide: 1024, q: 0.72 },
];
const KEY = "schema.uploadQuality";
export function getQuality(): Quality {
  try { const v = localStorage.getItem(KEY); if (QUALITIES.some((q) => q.id === v)) return v as Quality; } catch { /* ignore */ }
  return "original";
}
export function setQuality(q: Quality) { try { localStorage.setItem(KEY, q); } catch { /* ignore */ } }
const RANK: Record<Quality, number> = { original: 0, high: 1, medium: 2, low: 3 };
/** The lower of two qualities. */
export const lowerQuality = (a: Quality, b: Quality): Quality => (RANK[a] >= RANK[b] ? a : b);

/**
 * Automatic quality: the more pictures and PDF pages a board holds (counting the ones being added), the lighter new
 * ones are made, so a big board stays quick to open and doesn't fill up storage. Small boards keep the chosen quality.
 */
export function autoQualityFor(pictures: number): Quality {
  if (pictures > 250) return "low";
  if (pictures > 100) return "medium";
  if (pictures > 30) return "high";
  return "original";
}

/** Longest side, in pixels, for PDF pages at a quality (sheets need more pixels than photos). */
export const pdfSideFor = (q: Quality) => ({ original: 4000, high: 3000, medium: 2000, low: 1400 })[q];

/**
 * Re-encodes a picture smaller at the given quality. GIFs and SVGs are left alone (they'd lose their
 * animation or sharpness), and so is anything that wouldn't get smaller.
 */
export async function reduceImage(blob: Blob, quality: Quality): Promise<Blob> {
  const def = QUALITIES.find((q) => q.id === quality)!;
  if (quality === "original" || blob.type === "image/gif" || blob.type === "image/svg+xml") return blob;
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, def.maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  // WebP keeps transparency and is much smaller than PNG; JPEG where WebP encoding isn't available.
  let out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", def.q));
  if (!out || out.type !== "image/webp") out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", def.q));
  return out && out.size < blob.size ? out : blob;
}
