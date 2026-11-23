"use client";

import type { ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import { makeElement, type BoardElement } from "@/lib/board/types";
import type { BoardScale, Unit } from "@/lib/board/arch";

/** What a plug-in panel gets from the board. */
export type PluginContext = {
  elements: BoardElement[];
  selected: BoardElement[];
  api: {
    add: (els: BoardElement[]) => void;
    updateMany: (p: { id: string; patch: Partial<BoardElement> }[]) => void;
    remove: (ids: string[]) => void;
  };
  center: () => { x: number; y: number };
  select: (ids: string[]) => void;
  /** Moves the view to show these elements. */
  focus: (els: BoardElement[]) => void;
  toast: (msg: string) => void;
  upload: (blob: Blob, name: string) => Promise<string>;
  boardScale: BoardScale;
  unit: Unit;
  user: { id: string; name: string } | null;
  boardTitle: string;
  boardId: string;
  /** A picture of a part of the board, as the board shows it; null when nothing could be drawn. */
  exportImage: (rect: { x: number; y: number; width: number; height: number }, pixelsPerUnit: number, type?: "image/png" | "image/jpeg") => Promise<Blob | null>;
};

export function PluginPanel({ icon: Icon, title, onClose, children }: { icon: LucideIcon; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="absolute right-3 top-16 z-20 flex max-h-[calc(100%-5rem)] w-80 max-w-[calc(100vw-24px)] flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-100 p-3">
        <h2 className="flex items-center gap-2 font-semibold"><Icon size={16} className="text-rose-700" /> {title}</h2>
        <button className="btn-ghost p-1" title="Close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="space-y-4 overflow-y-auto p-3 text-sm">{children}</div>
    </aside>
  );
}

export function Section({ title, hint, children, divided }: { title: string; hint?: ReactNode; children?: ReactNode; divided?: boolean }) {
  return (
    <section className={`space-y-2 ${divided ? "border-t border-slate-100 pt-3" : ""}`}>
      <h3 className="font-medium">{title}</h3>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {children}
    </section>
  );
}

/** Bounding box of some elements; null for none. */
export function boxOf(els: BoardElement[]) {
  if (!els.length) return null;
  const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y));
  const x1 = Math.max(...els.map((e) => e.x + e.width)), y1 = Math.max(...els.map((e) => e.y + e.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Writes a plug-in's table (room schedule, finishes, decision log): updates the one on the board, else adds it below `near`
 * (or in the middle of the view). Returns the table's id.
 */
export function upsertTable(ctx: PluginContext, kind: "rooms" | "finishes" | "decisions", cells: string[][], width: number,
  near?: { x: number; y: number; width: number; height: number } | null, scale = 1): string {
  const existing0 = ctx.elements.find((e) => e.type === "table" && e.meta?.table === kind);
  // an existing table keeps the size it was given (or that someone resized it to)
  if (existing0) scale = existing0.width / width;
  width *= scale;
  const height = 34 * scale * cells.length;
  const existing = existing0;
  if (existing) {
    ctx.api.updateMany([{ id: existing.id, patch: { cells, height, header: true } as Partial<BoardElement> }]);
    return existing.id;
  }
  const c = ctx.center();
  const x = near ? near.x : c.x - width / 2, y = near ? near.y + near.height + 60 * scale : c.y - height / 2;
  const t = makeElement("table", x, y, { width, height, cells, header: true, fontSize: Math.round(14 * scale), meta: { table: kind } } as Partial<BoardElement>);
  ctx.api.add([t]);
  return t.id;
}
