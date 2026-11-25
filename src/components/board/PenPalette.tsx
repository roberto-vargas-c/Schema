"use client";

import { useState } from "react";
import { Brush, Highlighter, PenLine, PenTool, Pencil, type LucideIcon } from "lucide-react";
import { ColorWheel } from "./ColorWheel";
import { PEN_TIPS, TIP_BY_ID, tipColor, type PenTip } from "@/lib/board/penTips";

const SWATCHES = ["#111827", "#ffffff", "#0f8573", "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a"];
const TIP_ICONS: Record<PenTip, LucideIcon> = { pen: PenLine, pencil: Pencil, fineliner: PenTool, marker: Brush, highlighter: Highlighter };

/** Side palette for the pen and highlighter: tips, colors, a color wheel with eyedropper, and stroke widths. */
export function PenPalette({ tip, setTip, color, setColor, width, setWidth }: {
  tip: PenTip; setTip: (t: PenTip) => void;
  color: string; setColor: (c: string) => void; width: number; setWidth: (w: number) => void;
}) {
  const [wheel, setWheel] = useState(false);
  const def = TIP_BY_ID[tip];
  const custom = !SWATCHES.includes(color.toLowerCase());
  // Scale the width dots so each tip's range fills the column.
  const k = Math.min(4, 22 / Math.max(...def.widths));
  const ink = tipColor(tip, color);
  return (
    <div className="absolute left-3 top-[4.25rem] z-10 flex gap-2 sm:left-16 sm:top-1/2 sm:ml-2 sm:-translate-y-1/2" onPointerDown={(e) => e.stopPropagation()}>
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
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
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
      </div>
      {wheel && (
        <div className="card self-center p-3">
          <ColorWheel value={color} onChange={setColor} />
        </div>
      )}
    </div>
  );
}
