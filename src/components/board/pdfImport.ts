"use client";

export type RenderedPage = { blob: Blob; page: number; widthPt: number; heightPt: number };

const MAX_PAGES = 30;
const TARGET_PX = 4000; // longest side of each rendered sheet

/** Render each PDF page to a high-resolution PNG in the browser using pdf.js. */
/** `targetPx` is the longest side of each page, or a function of the page count that returns it. */
export async function renderPdf(file: File, onProgress?: (done: number, total: number) => void, targetPx: number | ((pages: number) => number) = TARGET_PX): Promise<RenderedPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const total = Math.min(doc.numPages, MAX_PAGES);
  const side = typeof targetPx === "function" ? targetPx(total) : targetPx;
  const out: RenderedPage[] = [];
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 }); // 1 unit = 1 PDF point
    const scale = Math.min(6, side / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    // Full-resolution sheets stay lossless; smaller ones are compressed.
    let blob = side >= TARGET_PX
      ? await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"))
      : await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
    if (!blob || blob.size > 24 * 1024 * 1024) blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (!blob) throw new Error(`Could not render page ${n}`);
    out.push({ blob, page: n, widthPt: base.width, heightPt: base.height });
    onProgress?.(n, total);
    page.cleanup();
  }
  await task.destroy();
  return out;
}
