"use client";

import { useState } from "react";
import { FileUp, Ruler, Square as AreaIcon, BrickWall, Cloud, Highlighter, Shapes, Scale, X, Puzzle } from "lucide-react";
import { PLUGINS, type PluginId } from "./plugins/registry";
import { SYMBOLS, UNITS, type SymbolDef, type Unit } from "@/lib/board/arch";
import type { Tool } from "./Canvas";

export function SymbolPreview({ def, size = 40 }: { def: SymbolDef; size?: number }) {
  const [w, h] = def.vb;
  const pad = Math.max(w, h) * 0.06;
  return (
    <svg width={size} height={size} viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} aria-hidden>
      <path d={def.d} fill={def.fill ?? "none"} stroke="#111827" strokeWidth={Math.max(w, h) / 40} strokeLinejoin="round" />
    </svg>
  );
}

const ARCH_TOOLS: { id: Tool; label: string; key: string; icon: typeof Ruler }[] = [
  { id: "calibrate", label: "Set scale: draw over a known dimension", key: "K", icon: Scale },
  { id: "measure", label: "Measure length", key: "M", icon: Ruler },
  { id: "area", label: "Measure area", key: "A", icon: AreaIcon },
  { id: "wall", label: "Wall (Shift snaps angles)", key: "W", icon: BrickWall },
  { id: "cloud", label: "Revision cloud", key: "Q", icon: Cloud },
  { id: "highlighter", label: "Highlighter", key: "I", icon: Highlighter },
];

export function ArchToolbar({
  tool, setTool, onImportPlan, importing, placingSymbol, setPlacingSymbol, unit, setUnit, scaleText, mobileOpen, plugin, onPlugin,
}: {
  tool: Tool; setTool: (t: Tool) => void; onImportPlan: () => void; importing: string | null;
  placingSymbol: string | null; setPlacingSymbol: (id: string | null) => void;
  unit: Unit; setUnit: (u: Unit) => void; scaleText: string;
  /** On phones the plan tools sit behind a toggle in the main toolbar. */
  mobileOpen?: boolean;
  /** The open plug-in, and opening one from the Plug-ins menu. */
  plugin: PluginId | null; onPlugin: (id: PluginId) => void;
}) {
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const btn = (active: boolean) =>
    `flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${active ? "bg-rose-700 text-white" : "text-slate-700 hover:bg-slate-100"}`;
  const groups = Array.from(new Set(SYMBOLS.map((s) => s.group)));

  return (
    <div className={`absolute bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3.75rem)] left-3 right-3 z-10 sm:bottom-3 sm:left-1/2 sm:right-auto sm:block sm:-translate-x-1/2 ${mobileOpen ? "" : "hidden"}`}>
      {symbolsOpen && (
        <div className="card absolute bottom-14 left-0 right-0 max-h-[55vh] overflow-y-auto p-3 sm:left-1/2 sm:right-auto sm:max-h-[60vh] sm:w-[min(560px,calc(100vw-24px))] sm:-translate-x-1/2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Plan symbols</h3>
            <button className="btn-ghost p-1" onClick={() => setSymbolsOpen(false)}><X size={14} /></button>
          </div>
          <p className="mb-2 text-xs text-slate-500">Pick a symbol, then click on the plan. It's sized to real dimensions when the plan has a scale.</p>
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{g}</div>
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                {SYMBOLS.filter((s) => s.group === g).map((s) => (
                  <button key={s.id} title={`${s.name} (${s.size[0]} × ${s.size[1]} m)`}
                    className={`flex flex-col items-center gap-1 rounded-lg p-1.5 text-[10px] leading-tight hover:bg-slate-100 ${placingSymbol === s.id && tool === "symbol" ? "bg-rose-50 ring-1 ring-rose-300" : ""}`}
                    onClick={() => { setPlacingSymbol(s.id); setTool("symbol"); setSymbolsOpen(false); }}>
                    <SymbolPreview def={s} size={36} />
                    <span className="text-center text-slate-600">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {pluginsOpen && (
        <div className="card absolute bottom-14 left-0 right-0 p-2 sm:left-auto sm:right-0 sm:w-80">
          <div className="mb-1 flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold">Plug-ins</h3>
            <button className="btn-ghost p-1" title="Close" onClick={() => setPluginsOpen(false)}><X size={14} /></button>
          </div>
          <ul>
            {PLUGINS.map((pl) => (
              <li key={pl.id}>
                <button className={`flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-slate-100 ${plugin === pl.id ? "bg-rose-50" : ""}`}
                  onClick={() => { onPlugin(pl.id); setPluginsOpen(false); }}>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-700"><pl.icon size={17} /></span>
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{pl.name}</span>
                    <span className="block text-xs text-slate-500">{pl.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg [scrollbar-width:none] sm:overflow-visible">
        <button className="btn-ghost h-9 shrink-0 px-2.5 text-sm" title="Import a PDF or image plan" onClick={onImportPlan} disabled={!!importing}>
          <FileUp size={16} /> <span className="hidden sm:inline">{importing ?? "Import plan"}</span>
        </button>
        <div className="mx-0.5 h-6 w-px bg-slate-200" />
        {ARCH_TOOLS.map((t) => (
          <button key={t.id} className={btn(tool === t.id)} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
            <t.icon size={17} />
          </button>
        ))}
        <button className={btn(symbolsOpen || tool === "symbol")} title="Plan symbols: doors, windows, furniture…" onClick={() => { setSymbolsOpen((o) => !o); setPluginsOpen(false); }}>
          <Shapes size={17} />
        </button>
        <button className={`h-9 shrink-0 rounded-lg px-2.5 text-sm transition ${pluginsOpen || plugin ? "bg-rose-700 text-white" : "text-slate-700 hover:bg-slate-100"} flex items-center gap-1.5`}
          title="Plug-ins: tracing paper, site analysis…" aria-expanded={pluginsOpen} onClick={() => { setPluginsOpen((o) => !o); setSymbolsOpen(false); }}>
          <Puzzle size={16} /> <span className="hidden sm:inline">Plug-ins</span>
        </button>
        <div className="mx-0.5 h-6 w-px bg-slate-200" />
        <span className="hidden max-w-[16ch] truncate px-1 text-xs text-slate-500 md:inline" title={scaleText}>{scaleText}</span>
        <select className="rounded-md border border-slate-200 px-1 py-1 text-xs" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} title="Units">
          {UNITS.map((u) => <option key={u.id} value={u.id}>{u.id === "ft" ? "ft-in" : u.id}</option>)}
        </select>
      </div>
    </div>
  );
}

