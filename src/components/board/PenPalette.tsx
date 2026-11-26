"use client";

import { useState } from "react";
import { Brush, Eraser, Highlighter, PenLine, PenTool, Pencil, type LucideIcon } from "lucide-react";
import { ColorWheel } from "./ColorWheel";
import { PEN_TIPS, TIP_BY_ID, tipColor, type PenTip } from "@/lib/board/penTips";

const SWATCHES = ["#111827", "#ffffff", "#0f8573", "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a"];
const TIP_ICONS: Record<PenTip, LucideIcon> = { pen: PenLine, pencil: Pencil, fineliner: PenTool, marker: Brush, highlighter: Highlighter };

/** Where the pen menu sits: below the header on phones, beside the left toolbar on wider screens. */
const PLACE = "absolute left-3 top-[4.25rem] z-10 sm:left-16 sm:top-1/2 sm:ml-2 sm:-translate-y-1/2";

/**
 * Side palette for the pen and highlighter: tips, the eraser, colors, a color wheel with eyedropper,
 * and stroke widths. `tip` is "eraser" while the eraser is on (it has no colors or widths).
 */
export function PenPalette({ tip, setTip, color, setColor, width, setWidth }: {
  tip: PenTip | "eraser"; setTip: (t: PenTip | "eraser") => void;
  color: string; setColor: (c: string) => void; width: number; setWidth: (w: number) => void;
}) {
  const [wheel, setWheel] = useState(false);
  const erasing = tip === "eraser";
  const def = TIP_BY_ID[erasing ? "pen" : tip];
  const custom = !SWATCHES.includes(color.toLowerCase());
  // Scale the width dots so each tip's range fills the column.
  const k = Math.min(4, 22 / Math.max(...def.widths));
  const ink = tipColor(def.id, color);
  return (
    <div className={`${PLACE} flex gap-2`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex flex-col gap-1 self-start rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg sm:self-center">
        {PEN_TIPS.map((t) => {
          const Icon = TIP_ICONS[t.id];
          return (
            <button key={t.id} title={t.label} aria-label={t.label} aria-pressed={tip === t.id} onClick={() => setTip(t.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${tip === t.id ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
              <Icon size={18} />
            </button>
          );
        })}
        <div className="mx-1 my-0.5 h-px bg-slate-100" />
        <button title="Eraser (E): wipe over strokes to remove them" aria-label="Eraser" aria-pressed={erasing} onClick={() => setTip("eraser")}
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${erasing ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
          <Eraser size={18} />
        </button>
      </div>
      {!erasing && <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
        <div className="grid grid-cols-2 gap-1.5">
          {SWATCHES.map((c) => (
            <button key={c} title={c} onClick={() => setColor(c)}
              className={`h-6 w-6 rounded-full border border-slate-200 ${color.toLowerCase() === c ? "ring-2 ring-brand-500 ring-offset-1" : ""}`} style={{ background: c }} />
          ))}
          <button title="More colors" onClick={() => setWheel((w) => !w)}
            className={`col-span-2 mx-auto h-6 w-6 rounded-full ${custom || wheel ? "ring-2 ring-brand-500 ring-offset-1" : ""}`}
            style={{ background: custom ? color : "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }} />
        </div>
        <div className="my-0.5 h-px bg-slate-100" />
        {def.widths.map((w) => {
          const d = Math.min(22, Math.max(2, w * k));
          return (
            <button key={w} title={`${w} px`} onClick={() => setWidth(w)}
              className={`flex h-7 w-full items-center justify-center rounded-md ${width === w ? "bg-brand-50 ring-1 ring-brand-500" : "hover:bg-slate-100"}`}>
              <span className="block rounded-full" style={{
                width: d, height: d, background: ink === "#ffffff" ? "#cbd5e1" : ink, opacity: Math.max(0.5, def.opacity),
              }} />
            </button>
          );
        })}
      </div>}
      {wheel && !erasing && (
        <div className="card self-center p-3">
          <ColorWheel value={color} onChange={setColor} />
        </div>
      )}
    </div>
  );
}

/**
 * The pen menu folded away (it closes when a stroke starts so it doesn't cover the drawing):
 * one button showing the current tip and color that opens it again.
 */
export function PenMenuButton({ tip, color, onOpen }: { tip: PenTip | "eraser"; color: string; onOpen: () => void }) {
  const Icon = tip === "eraser" ? Eraser : TIP_ICONS[tip];
  const ink = tip === "eraser" ? null : tipColor(tip, color);
  return (
    <div className={PLACE} onPointerDown={(e) => e.stopPropagation()}>
      <button title="Pen options" aria-label="Pen options" onClick={onOpen}
        className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-lg hover:bg-slate-100">
        <Icon size={18} />
        {ink && <span className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full border border-white" style={{ background: ink }} />}
      </button>
    </div>
  );
}
