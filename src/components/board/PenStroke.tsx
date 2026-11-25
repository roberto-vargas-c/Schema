"use client";

import { Line, Shape } from "react-konva";
import { tipOf } from "@/lib/board/penTips";

/** One drawn stroke, in the look of its tip. Used for saved strokes and the stroke being drawn. */
export function PenStroke({ points, stroke, width, tip, opacity }: {
  points: number[]; stroke: string; width: number; tip?: string; opacity: number;
}) {
  const def = tipOf(tip);
  if (!def.textured) {
    return <Line points={points} stroke={stroke} strokeWidth={width} lineCap={def.lineCap} lineJoin="round" tension={def.tension} opacity={opacity} />;
  }
  return (
    <Shape listening={false} opacity={opacity} perfectDrawEnabled={false}
      sceneFunc={(context) => {
        const ctx = context._context;
        const tex = grain(stroke);
        const pattern = tex ? ctx.createPattern(tex, "repeat") : null;
        if (pattern && typeof DOMMatrix !== "undefined") {
          // Keep the grain the same size on screen at any zoom, so a close-up does not turn it into blocks.
          const m = ctx.getTransform();
          const ratio = context.canvas.pixelRatio || 1;
          const k = ratio / (Math.hypot(m.a, m.b) || 1);
          pattern.setTransform(new DOMMatrix().scale(k, k));
        }
        ctx.lineWidth = width;
        ctx.lineCap = def.lineCap;
        ctx.lineJoin = "round";
        ctx.strokeStyle = pattern ?? stroke;
        trace(ctx, points);
        ctx.stroke();
      }} />
  );
}

/** A smoothed path through the points (midpoint quadratic curves). */
function trace(ctx: CanvasRenderingContext2D, pts: number[]) {
  const n = pts.length / 2;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n - 1; i++) {
    const x = pts[2 * i], y = pts[2 * i + 1];
    ctx.quadraticCurveTo(x, y, (x + pts[2 * i + 2]) / 2, (y + pts[2 * i + 3]) / 2);
  }
  if (n > 1) ctx.lineTo(pts[2 * n - 2], pts[2 * n - 1]);
}

const grainCache = new Map<string, HTMLCanvasElement>();
const GRAIN = 64;

/** A tile of the color with speckled transparency, like graphite on paper. The seed is fixed so every viewer sees the same grain. */
function grain(color: string): HTMLCanvasElement | null {
  const hit = grainCache.get(color);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = GRAIN;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, GRAIN, GRAIN);
  const img = ctx.getImageData(0, 0, GRAIN, GRAIN);
  let s = 0x2f6b9a31;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 3; i < img.data.length; i += 4) {
    const r = rnd();
    img.data[i] = r < 0.2 ? 0 : Math.round(70 + r * 185);
  }
  ctx.putImageData(img, 0, 0);
  if (grainCache.size > 64) grainCache.clear();
  grainCache.set(color, c);
  return c;
}
