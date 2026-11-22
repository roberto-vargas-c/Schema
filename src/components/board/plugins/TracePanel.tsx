"use client";

import { Eye, EyeOff, Layers, StickyNote, X, Columns2 } from "lucide-react";
import type { BoardElement, ImageElement } from "@/lib/board/types";
import { makeElement } from "@/lib/board/types";
import { metersPerPxOfPlan } from "@/lib/board/arch";

export const TRACE_COLORS = ["#dc2626", "#2563eb", "#16a34a", "#9333ea", "#ea580c"];
const TRACE_PAPER = "#fdf8e4";

type Api = { add: (els: BoardElement[]) => void; updateMany: (p: { id: string; patch: Partial<BoardElement> }[]) => void };

const isPicture = (e: BoardElement): e is ImageElement => e.type === "image" && !(e as ImageElement).animated;
const layerName = (e: ImageElement, i: number) => e.plan ? `${e.plan.name}${e.plan.page ? ` · p. ${e.plan.page}` : ""}` : `Picture ${i + 1}`;

/**
 * Tracing paper plug-in. Overlay: the selected plans go onto the lowest one, at the same real scale when they have one, each
 * drawn as lines in its own color on a see-through ground, so the differences between versions show. Each layer then has an
 * opacity slider and can be hidden. Tracing sheet: a sheet of yellow trace over the selection to sketch on.
 */
export function TracePanel({ selected, api, center, onSelect, toast, onClose }: {
  selected: BoardElement[]; api: Api; center: () => { x: number; y: number };
  onSelect: (ids: string[]) => void; toast: (msg: string) => void; onClose: () => void;
}) {
  const pics = selected.filter(isPicture);
  const layers = [...pics].sort((a, b) => b.z - a.z); // top first, as in a layers panel

  const overlay = () => {
    const stack = [...pics].sort((a, b) => a.z - b.z);
    const base = stack[0];
    const baseMpp = metersPerPxOfPlan(base);
    const patches = stack.map((el, i) => {
      if (i === 0) return { id: el.id, patch: { tint: TRACE_COLORS[0], opacity: 1 } as Partial<ImageElement> };
      const mpp = metersPerPxOfPlan(el);
      // same real scale when both are scaled, else the same width (sheets of one drawing set)
      const k = baseMpp && mpp ? mpp / baseMpp : base.width / Math.max(1, el.width);
      return {
        id: el.id,
        patch: {
          x: base.x, y: base.y, width: el.width * k, height: el.height * k, rotation: base.rotation,
          tint: TRACE_COLORS[i % TRACE_COLORS.length], opacity: 0.85, locked: false,
        } as Partial<ImageElement>,
      };
    });
    api.updateMany(patches as { id: string; patch: Partial<BoardElement> }[]);
    onSelect(stack.slice(1).map((e) => e.id).concat(base.id));
    const scaled = baseMpp && stack.slice(1).every((e) => metersPerPxOfPlan(e));
    toast(`${stack.length} layers overlaid${scaled ? " at the same scale" : ""}. Nudge the top one with the arrow keys to line them up.`);
  };

  const sideBySide = () => {
    const stack = [...pics].sort((a, b) => a.z - b.z);
    let x = stack[0].x;
    api.updateMany(stack.map((el) => {
      const patch = { x, y: stack[0].y, tint: undefined, opacity: 1 } as Partial<ImageElement>;
      x += el.width + 120;
      return { id: el.id, patch: patch as Partial<BoardElement> };
    }));
  };

  const setLayer = (el: ImageElement, patch: Partial<ImageElement>) => api.updateMany([{ id: el.id, patch: patch as Partial<BoardElement> }]);

  const addSheet = () => {
    const box = selected.length
      ? selected.reduce((b, e) => ({ x0: Math.min(b.x0, e.x), y0: Math.min(b.y0, e.y), x1: Math.max(b.x1, e.x + e.width), y1: Math.max(b.y1, e.y + e.height) }),
        { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
      : (() => { const c = center(); return { x0: c.x - 420, y0: c.y - 300, x1: c.x + 420, y1: c.y + 300 }; })();
    const pad = selected.length ? 40 : 0;
    const top = selected.reduce((m, e) => Math.max(m, e.z), Date.now());
    const sheet = makeElement("rect", box.x0 - pad, box.y0 - pad, {
      width: box.x1 - box.x0 + pad * 2, height: box.y1 - box.y0 + pad * 2, fill: TRACE_PAPER, stroke: "#e7dcb0", opacity: 0.72, text: "", z: top + 1,
    });
    api.add([sheet]);
    onSelect([sheet.id]);
    toast("Tracing sheet added. Sketch on it with the pen; move it aside to compare.");
  };

  return (
    <aside className="absolute right-3 top-16 z-20 flex max-h-[calc(100%-5rem)] w-80 max-w-[calc(100vw-24px)] flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-100 p-3">
        <h2 className="flex items-center gap-2 font-semibold"><Layers size={16} className="text-rose-700" /> Tracing paper</h2>
        <button className="btn-ghost p-1" title="Close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="space-y-4 overflow-y-auto p-3 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium">Overlay plans</h3>
          <p className="text-xs text-slate-500">
            Select two or more plans or pictures, such as two versions of a floor plan. They go onto the lowest one, each in its own
            color, with the paper see-through.
          </p>
          <button className="btn-primary w-full justify-center" disabled={pics.length < 2} onClick={overlay}>
            {pics.length < 2 ? "Select at least two plans" : `Overlay ${pics.length} plans`}
          </button>
        </section>

        {layers.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Layers</h3>
              {layers.length > 1 && (
                <button className="btn-ghost px-2 py-1 text-xs" title="Lay them out next to each other again, without color" onClick={sideBySide}>
                  <Columns2 size={14} /> Side by side
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {layers.map((el, i) => {
                const hidden = (el.opacity ?? 1) === 0;
                return (
                  <li key={el.id} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5" role="radiogroup" aria-label="Line color">
                        {TRACE_COLORS.map((c) => (
                          <button key={c} role="radio" aria-checked={el.tint === c} title="Line color"
                            className={`h-4 w-4 rounded-full ${el.tint === c ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                            style={{ background: c }} onClick={() => setLayer(el, { tint: c })} />
                        ))}
                        <button title="Original colors" aria-checked={!el.tint} role="radio"
                          className={`h-4 w-4 rounded-full border border-slate-300 bg-[conic-gradient(#f87171,#facc15,#4ade80,#60a5fa,#f87171)] ${!el.tint ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                          onClick={() => setLayer(el, { tint: undefined })} />
                      </div>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={layerName(el, i)}>{layerName(el, layers.length - 1 - i)}</span>
                      <button className="btn-ghost p-1" title={hidden ? "Show" : "Hide"} onClick={() => setLayer(el, { opacity: hidden ? 0.85 : 0 })}>
                        {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <input type="range" min={0} max={100} value={Math.round((el.opacity ?? 1) * 100)} aria-label="Opacity"
                      className="mt-1 w-full accent-rose-700" onChange={(e) => setLayer(el, { opacity: Number(e.target.value) / 100 })} />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="space-y-2 border-t border-slate-100 pt-3">
          <h3 className="font-medium">Tracing sheet</h3>
          <p className="text-xs text-slate-500">A sheet of yellow trace over the selection (or the middle of the view) to sketch on.</p>
          <button className="btn-outline w-full justify-center" onClick={addSheet}><StickyNote size={15} /> Add a tracing sheet</button>
        </section>
      </div>
    </aside>
  );
}
