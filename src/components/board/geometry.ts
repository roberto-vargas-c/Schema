import type { BoardElement, ConnectorElement, PenElement } from "@/lib/board/types";

export type Rect = { x: number; y: number; width: number; height: number };
export type Camera = { x: number; y: number; scale: number };

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 8;
export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function bounds(el: BoardElement): Rect {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

export function contains(outer: Rect, inner: Rect) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width); y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Point where the segment from the rect's center toward `toward` leaves the rect (plus a small gap). */
function edgePoint(r: Rect, toward: { x: number; y: number }, gap = 6) {
  const c = center(r);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.width / 2 + gap, hh = r.height / 2 + gap;
  const t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: c.x + dx * Math.min(t, 1), y: c.y + dy * Math.min(t, 1) };
}

/** Resolve a connector's endpoints, following the elements it's attached to. */
export function connectorPoints(c: ConnectorElement, byId: Map<string, BoardElement>) {
  const a = c.from.id ? byId.get(c.from.id) : undefined;
  const b = c.to.id ? byId.get(c.to.id) : undefined;
  const pa = a ? center(bounds(a)) : { x: c.from.x, y: c.from.y };
  const pb = b ? center(bounds(b)) : { x: c.to.x, y: c.to.y };
  const start = a ? edgePoint(bounds(a), pb) : pa;
  const end = b ? edgePoint(bounds(b), pa) : pb;
  return [start.x, start.y, end.x, end.y];
}

/** Topmost attachable element under a world point (connectors, pen strokes and frames' interiors excluded). */
export function hitElement(els: BoardElement[], p: { x: number; y: number }, excludeId?: string) {
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.id === excludeId || e.type === "connector" || e.type === "pen") continue;
    if (p.x >= e.x && p.x <= e.x + e.width && p.y >= e.y && p.y <= e.y + e.height) return e;
  }
  return undefined;
}

/**
 * Whether a circle of radius `r` around world point `p` touches a pen stroke's line (its width counts).
 * Used by the eraser.
 */
export function penStrokeHit(el: PenElement, p: { x: number; y: number }, r: number): boolean {
  const pad = r + (el.strokeWidth ?? 2) / 2;
  // Quick reject with the stroke's box (rotation turns around x,y, so pad the box by its diagonal).
  const reach = el.rotation ? Math.hypot(el.width, el.height) : 0;
  if (p.x < el.x - reach - pad || p.x > el.x + el.width + reach + pad || p.y < el.y - reach - pad || p.y > el.y + el.height + reach + pad) return false;
  // Into the stroke's own frame: points are relative to x,y and rotate around it.
  let lx = p.x - el.x, ly = p.y - el.y;
  if (el.rotation) {
    const a = (-el.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    [lx, ly] = [lx * c - ly * s, lx * s + ly * c];
  }
  const pts = el.points;
  if (pts.length < 2) return false;
  if (pts.length < 4) return Math.hypot(lx - pts[0], ly - pts[1]) <= pad;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((lx - ax) * dx + (ly - ay) * dy) / len2)) : 0;
    if (Math.hypot(lx - (ax + t * dx), ly - (ay + t * dy)) <= pad) return true;
  }
  return false;
}

type Side = "l" | "r" | "t" | "b";
function sidePoint(r: Rect, side: Side, gap = 6) {
  const c = center(r);
  if (side === "l") return { x: r.x - gap, y: c.y };
  if (side === "r") return { x: r.x + r.width + gap, y: c.y };
  if (side === "t") return { x: c.x, y: r.y - gap };
  return { x: c.x, y: r.y + r.height + gap };
}
const OUT: Record<Side, [number, number]> = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };

/**
 * Points to draw a connector with. Curved and elbow connectors leave and enter elements through
 * the middle of a side; curved ones are a cubic Bézier (draw with `bezier`), elbows are orthogonal.
 */
export function connectorPath(c: ConnectorElement, byId: Map<string, BoardElement>): { points: number[]; bezier: boolean } {
  const style = c.style ?? "straight";
  if (style === "straight") return { points: connectorPoints(c, byId), bezier: false };
  const a = c.from.id ? byId.get(c.from.id) : undefined;
  const b = c.to.id ? byId.get(c.to.id) : undefined;
  const pa = a ? center(bounds(a)) : { x: c.from.x, y: c.from.y };
  const pb = b ? center(bounds(b)) : { x: c.to.x, y: c.to.y };
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  const sa: Side = horiz ? (dx >= 0 ? "r" : "l") : (dy >= 0 ? "b" : "t");
  const sb: Side = horiz ? (dx >= 0 ? "l" : "r") : (dy >= 0 ? "t" : "b");
  const s = a ? sidePoint(bounds(a), sa) : pa;
  const e = b ? sidePoint(bounds(b), sb) : pb;
  if (style === "curved") {
    const k = Math.max(30, (horiz ? Math.abs(e.x - s.x) : Math.abs(e.y - s.y)) * 0.5);
    const [ax, ay] = OUT[sa], [bx, by] = OUT[sb];
    return { points: [s.x, s.y, s.x + ax * k, s.y + ay * k, e.x + bx * k, e.y + by * k, e.x, e.y], bezier: true };
  }
  if (horiz) {
    const mx = (s.x + e.x) / 2;
    return { points: [s.x, s.y, mx, s.y, mx, e.y, e.x, e.y], bezier: false };
  }
  const my = (s.y + e.y) / 2;
  return { points: [s.x, s.y, s.x, my, e.x, my, e.x, e.y], bezier: false };
}
