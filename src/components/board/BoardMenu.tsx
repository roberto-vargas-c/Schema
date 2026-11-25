"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Accessibility, BoxSelect, Check, ChevronLeft, ChevronRight, Copy, Ellipsis, Expand, Eye, FileDown, FileImage, FileSpreadsheet, Grid3x3, History,
  Import, Keyboard, LayoutDashboard, LayoutTemplate, MessageSquare, MousePointer2, PenLine, Redo2, RotateCcw, Ruler, Shrink, SlidersHorizontal,
  Spline, ImageDown, Trash2, Undo2, UserRound, Wind, X, Plus, CopyPlus, Upload, FolderInput, Star, PaintBucket, ScanEye, Maximize, Info, Moon,
} from "lucide-react";
import type { BoardPrefs, GridStyle } from "./boardPrefs";
import type { WheelMode } from "./Canvas";
import type { Sharing } from "./ShareDialog";
import type { BoardElement } from "@/lib/board/types";
import { parseCsv, csvToElements, CSV_LIMITS, type CsvMode } from "@/lib/board/csv";
import { saveBoardAsTemplate } from "@/app/actions/workspace";
import type { BoardApi } from "./useBoard";

export type ExportKind = "png" | "png-hi" | "pdf" | "pdf-frames";

// ── Board menu: board, edit, view, preferences and accessibility settings ───

type Sub = "board" | "edit" | "view" | "prefs" | "a11y";

const SUBS: { id: Sub; label: string; icon: React.ReactNode }[] = [
  { id: "board", label: "Board", icon: <LayoutDashboard size={16} /> },
  { id: "edit", label: "Edit", icon: <PenLine size={16} /> },
  { id: "view", label: "View", icon: <Eye size={16} /> },
  { id: "prefs", label: "Preferences", icon: <SlidersHorizontal size={16} /> },
  { id: "a11y", label: "Accessibility", icon: <Accessibility size={16} /> },
];

const GRID_LABEL: Record<GridStyle, string> = { dots: "Dots", lines: "Lines", none: "No grid" };
const WHEEL_CHOICES: { id: WheelMode; label: string; hint: string }[] = [
  { id: "auto", label: "Automatic", hint: "Mouse wheel zooms, trackpad scrolls" },
  { id: "zoom", label: "Always zoom", hint: "The wheel and trackpad both zoom" },
  { id: "pan", label: "Always scroll", hint: "Hold Ctrl or ⌘ to zoom" },
];

function useFullscreen() {
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(!!document.fullscreenEnabled);
    const upd = () => setOn(!!document.fullscreenElement);
    upd();
    document.addEventListener("fullscreenchange", upd);
    return () => document.removeEventListener("fullscreenchange", upd);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => { /* refused */ });
  };
  return { on, supported, toggle };
}

/** Board-level actions; each is left out when the viewer can't use it. */
export type BoardActions = {
  onNew?: () => void;
  onDuplicate?: () => void;
  folders?: { id: string; name: string }[];
  folderId?: string | null;
  onMove?: (folderId: string | null) => void;
  starred?: boolean;
  onToggleStar?: () => void;
  onDelete?: () => void;
  background: string | null;
  onBackground?: (color: string | null) => void;
  hasStartView: boolean;
  onStartView?: (set: boolean) => void;
  onHistory?: () => void;
  onDetails?: () => void;
};

export const BACKGROUNDS: { color: string | null; name: string }[] = [
  { color: null, name: "Default" },
  { color: "#ffffff", name: "White" },
  { color: "#f7f3ea", name: "Paper" },
  { color: "#fbf6dc", name: "Trace" },
  { color: "#e9f0fa", name: "Blueprint" },
  { color: "#e8f4f0", name: "Mint" },
  { color: "#eeece9", name: "Stone" },
];

export function BoardMenu({
  prefs, setPref, board, onExport, onImportCsv, onImportMiro, onSaveTemplate, onShortcuts,
  onUndo, onRedo, onSelectAll, onDuplicate, onDelete,
  canEdit, canTemplate, frameCount, hasSelection, dark, onToggleDark,
}: {
  prefs: BoardPrefs; setPref: <K extends keyof BoardPrefs>(k: K, v: BoardPrefs[K]) => void;
  board: BoardActions;
  onExport: (k: ExportKind) => void; onImportCsv: () => void; onImportMiro?: () => void; onSaveTemplate: () => void;
  onShortcuts: () => void;
  onUndo: () => void; onRedo: () => void; onSelectAll: () => void; onDuplicate: () => void; onDelete: () => void;
  canEdit: boolean; canTemplate: boolean; frameCount: number; hasSelection: boolean;
  dark?: boolean; onToggleDark?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<Sub | null>(null);
  const [subTop, setSubTop] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fs = useFullscreen();
  useEffect(() => {
    if (!open) { setSub(null); setExpanded(null); return; }
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (sub) setSub(null); else setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", esc, true); };
  }, [open, sub]);

  const openSub = (id: Sub, row: HTMLElement) => { setSub(id); setSubTop(row.offsetTop); setExpanded(null); };

  const action = (label: string, icon: React.ReactNode, onClick: () => void, opts: { disabled?: boolean; hint?: string; keys?: string } = {}) => (
    <button key={label} role="menuitem" className="btn-ghost w-full justify-start gap-2 text-left" disabled={opts.disabled} title={opts.hint}
      onClick={() => { setOpen(false); onClick(); }}>
      {icon}<span className="flex-1">{label}</span>
      {opts.keys && <kbd className="font-sans text-xs text-slate-400">{opts.keys}</kbd>}
    </button>
  );
  const toggle = (label: string, icon: React.ReactNode, on: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <button key={label} role="menuitemcheckbox" aria-checked={on} className="btn-ghost w-full justify-start gap-2 text-left" title={hint}
      onClick={() => onChange(!on)}>
      {icon}<span className="flex-1">{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
  const choice = (label: string, selected: boolean, onClick: () => void, hint?: string) => (
    <button key={label} role="menuitemradio" aria-checked={selected} className="btn-ghost w-full justify-start gap-2 text-left" onClick={onClick}>
      <Check size={16} className={selected ? "text-brand-600" : "invisible"} />
      <span className="flex-1">{label}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </button>
  );
  const heading = (t: string) => <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-slate-400">{t}</div>;
  const divider = <div className="my-1 h-px bg-slate-100" />;
  const expander = (id: string, label: string, icon: React.ReactNode, value: string | null, children: React.ReactNode) => (
    <div key={id}>
      <button role="menuitem" aria-expanded={expanded === id} className={`btn-ghost w-full justify-start gap-2 text-left ${expanded === id ? "bg-slate-100" : ""}`}
        onClick={() => setExpanded((x) => (x === id ? null : id))}>
        {icon}<span className="flex-1">{label}</span>
        {value && <span className="max-w-[7rem] truncate text-xs text-slate-500">{value}</span>}
        <ChevronRight size={14} className={`text-slate-400 transition-transform ${expanded === id ? "rotate-90" : ""}`} />
      </button>
      {expanded === id && <div className="mb-1 ml-4 border-l border-slate-100 pl-1">{children}</div>}
    </div>
  );
  const folderName = board.folderId ? board.folders?.find((f) => f.id === board.folderId)?.name ?? "Folder" : "No folder";
  const bgName = BACKGROUNDS.find((b) => b.color === board.background)?.name ?? "Custom";
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

  const body: Record<Sub, React.ReactNode> = {
    board: <>
      {board.onNew && action("New board", <Plus size={16} />, board.onNew, { hint: "A blank board in the same folder" })}
      {board.onDuplicate && action("Duplicate board", <CopyPlus size={16} />, board.onDuplicate, { hint: "Make a copy of this board and open it" })}
      {expander("export", `Export ${hasSelection ? "selection" : "board"}`, <Upload size={16} />, null, <>
        {action("Image (PNG)", <FileImage size={16} />, () => onExport("png"))}
        {action("High-resolution image (PNG)", <FileImage size={16} />, () => onExport("png-hi"))}
        {action("PDF", <FileDown size={16} />, () => onExport("pdf"))}
        {action(`PDF, one page per frame (${frameCount})`, <FileDown size={16} />, () => onExport("pdf-frames"), {
          disabled: frameCount === 0, hint: frameCount === 0 ? "Add frames to the board first" : "Each frame becomes a page, at its size on the board" })}
      </>)}
      {(board.onMove || board.onToggleStar || board.onDelete) && divider}
      {board.onMove && expander("move", "Move to", <FolderInput size={16} />, folderName, <>
        {choice("No folder", !board.folderId, () => { setOpen(false); board.onMove!(null); })}
        {board.folders?.map((f) => choice(f.name, board.folderId === f.id, () => { setOpen(false); board.onMove!(f.id); }))}
      </>)}
      {board.onToggleStar && action(board.starred ? "Unstar this board" : "Star this board",
        <Star size={16} className={board.starred ? "fill-amber-400 text-amber-500" : ""} />, board.onToggleStar)}
      {board.onDelete && action("Delete board", <Trash2 size={16} />, board.onDelete)}
      {divider}
      {board.onBackground && expander("bg", "Background color", <PaintBucket size={16} />, bgName, (
        <div className="grid grid-cols-4 gap-1.5 p-2">
          {BACKGROUNDS.map((b) => (
            <button key={b.name} title={b.name} aria-label={b.name} aria-pressed={board.background === b.color}
              className={`flex h-12 flex-col items-center justify-end rounded-lg border pb-1 text-[10px] text-slate-600 ${board.background === b.color ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300"}`}
              style={{ background: b.color ?? "#f8fafc" }} onClick={() => board.onBackground!(b.color)}>
              {b.name}
            </button>
          ))}
        </div>
      ))}
      {board.onStartView && expander("start", "Start view", <ScanEye size={16} />, board.hasStartView ? "Set" : "Whole board", <>
        {action("Use the current view", <ScanEye size={16} />, () => board.onStartView!(true), { hint: "Everyone opens the board here" })}
        {action("Open on the whole board", <Maximize size={16} />, () => board.onStartView!(false), { disabled: !board.hasStartView })}
      </>)}
      {board.onHistory && action("Version history", <History size={16} />, board.onHistory)}
      {board.onDetails && action("Details", <Info size={16} />, board.onDetails)}
      {(canEdit || canTemplate) && divider}
      {canEdit && action("Import CSV…", <FileSpreadsheet size={16} />, onImportCsv)}
      {canEdit && onImportMiro && action("Import from Miro…", <Import size={16} />, onImportMiro)}
      {canTemplate && action("Save board as template…", <LayoutTemplate size={16} />, onSaveTemplate)}
    </>,
    edit: <>
      {action("Undo", <Undo2 size={16} />, onUndo, { disabled: !canEdit, keys: `${mod}Z` })}
      {action("Redo", <Redo2 size={16} />, onRedo, { disabled: !canEdit, keys: mod === "⌘" ? "⇧⌘Z" : "Ctrl+Y" })}
      {divider}
      {action("Select all", <BoxSelect size={16} />, onSelectAll, { keys: `${mod}A` })}
      {action("Duplicate", <Copy size={16} />, onDuplicate, { disabled: !canEdit || !hasSelection, keys: `${mod}D` })}
      {action("Delete", <Trash2 size={16} />, onDelete, { disabled: !canEdit || !hasSelection, keys: "Del" })}
    </>,
    view: <>
      {expander("grid", "Grid", <Grid3x3 size={16} />, GRID_LABEL[prefs.grid],
        (Object.keys(GRID_LABEL) as GridStyle[]).map((g) => choice(GRID_LABEL[g], prefs.grid === g, () => setPref("grid", g))))}
      {toggle("Collaborators' cursors", <MousePointer2 size={16} />, prefs.showCursors, (v) => setPref("showCursors", v))}
      {toggle("Comments on board", <MessageSquare size={16} />, prefs.showComments, (v) => setPref("showComments", v), "Show comment pins on the canvas")}
      {toggle("Object dimensions", <Ruler size={16} />, prefs.showDimensions, (v) => setPref("showDimensions", v), "Show the width and height of the selected item")}
      {toggle("Undo and redo buttons", <Undo2 size={16} />, prefs.showUndoRedo, (v) => setPref("showUndoRedo", v), "Show undo and redo next to the zoom controls")}
      {toggle("Connectors", <Spline size={16} />, prefs.showConnectors, (v) => setPref("showConnectors", v), "Hide connector lines to see the board without them")}
      {toggle("Authors on sticky notes", <UserRound size={16} />, prefs.showAuthors, (v) => setPref("showAuthors", v))}
      {fs.supported && <>
        {divider}
        {action(fs.on ? "Exit full screen" : "Enter full screen", fs.on ? <Shrink size={16} /> : <Expand size={16} />, fs.toggle)}
      </>}
    </>,
    prefs: <>
      {onToggleDark && toggle("Dark mode", <Moon size={16} />, !!dark, () => onToggleDark())}
      {onToggleDark && divider}
      {heading("Scroll wheel")}
      {WHEEL_CHOICES.map((w) => choice(w.label, prefs.wheelMode === w.id, () => setPref("wheelMode", w.id), w.hint))}
      <p className="px-3 pb-1 pt-1 text-xs text-slate-500">Pinch always zooms.</p>
      {divider}
      {toggle("Lighter pictures on big boards", <ImageDown size={16} />, prefs.autoImageQuality, (v) => setPref("autoImageQuality", v),
        "New pictures and PDF pages are made smaller as the board fills up: over 30 up to 2560 px, over 100 up to 1600 px, over 250 up to 1024 px")}
      <p className="px-3 pb-1 pt-1 text-xs text-slate-500">Shrinks new uploads as the board passes 30, 100 and 250 pictures.</p>
    </>,
    a11y: <>
      {toggle("Reduce motion", <Wind size={16} />, prefs.reduceMotion, (v) => setPref("reduceMotion", v), "Jump instead of gliding when the view moves, and skip floating reactions")}
      {action("Keyboard shortcuts", <Keyboard size={16} />, onShortcuts)}
    </>,
  };

  const subLabel = SUBS.find((x) => x.id === sub)?.label;
  return (
    <div className="relative" ref={ref}>
      <button className={`btn-ghost p-1.5 ${open ? "bg-slate-100" : ""}`} title="Board menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={18} />
      </button>
      {open && (
        <div className="fixed left-3 right-3 top-40 z-40 sm:absolute sm:left-auto sm:right-0 sm:top-10 sm:z-30 sm:flex sm:flex-row-reverse sm:items-start sm:gap-1.5">
          <div role="menu" aria-label="Board menu" className={`card p-1 sm:w-56 ${sub ? "max-sm:hidden" : ""}`}>
            {SUBS.map((x) => (
              <button key={x.id} role="menuitem" aria-haspopup="menu" aria-expanded={sub === x.id}
                className={`btn-ghost w-full justify-start gap-2 text-left ${sub === x.id ? "bg-slate-100" : ""}`}
                onClick={(e) => (sub === x.id ? setSub(null) : openSub(x.id, e.currentTarget))}
                onPointerEnter={(e) => { if (e.pointerType === "mouse") openSub(x.id, e.currentTarget); }}>
                {x.icon}<span className="flex-1">{x.label}</span><ChevronRight size={14} className="text-slate-400" />
              </button>
            ))}
          </div>
          {sub && (
            <div role="menu" aria-label={subLabel} className="card max-h-[calc(100dvh-11rem)] overflow-y-auto p-1 sm:mt-[var(--sub-top)] sm:w-72"
              style={{ ["--sub-top" as string]: `${subTop}px` }}>
              <button className="btn-ghost w-full justify-start gap-2 text-left font-medium sm:hidden" onClick={() => setSub(null)}>
                <ChevronLeft size={16} /> {subLabel}
              </button>
              <div className="sm:hidden">{divider}</div>
              {body[sub]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Calls `onClose` on Escape. Registered once: re-registering on every render would drop the key
 * when another Escape handler re-renders the board while the event is still being dispatched.
 */
function useEscape(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") ref.current(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
}

export const SHORTCUTS: [string, string][] = [
  ["V", "Select"], ["H", "Hand (pan)"], ["Space + drag", "Pan"], ["N", "Sticky note"], ["T", "Text"], ["D", "Task card"],
  ["R", "Rectangle"], ["O", "Ellipse"], ["F", "Frame"], ["L", "Connector"], ["P", "Pen"], ["I", "Highlighter"],
  ["G", "Mind map"], ["C", "Comment"], ["M", "Measure"], ["A", "Area"], ["W", "Wall"], ["K", "Set scale"], ["Q", "Revision cloud"],
  ["Ctrl/⌘ + Z", "Undo"], ["Ctrl/⌘ + Shift + Z, Ctrl + Y", "Redo"], ["Ctrl/⌘ + A", "Select all"], ["Ctrl/⌘ + D", "Duplicate"],
  ["Ctrl/⌘ + C, V", "Copy and paste"], ["Delete", "Delete selection"], ["Arrow keys", "Nudge (Shift for more)"],
  ["Shift + drag", "Keep angles at 45°"], ["Esc", "Cancel or finish editing"],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Keyboard shortcuts" className="card flex max-h-[85dvh] w-full max-w-lg flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Keyboard size={18} /> Keyboard shortcuts</h2>
          <button className="btn-ghost p-1" onClick={onClose} title="Close"><X size={18} /></button>
        </div>
        <dl className="grid min-h-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 overflow-y-auto text-sm">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-xs">{k}</kbd></dt>
              <dd className="text-slate-700">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ── CSV import ──────────────────────────────────────────────────────────────

export function CsvDialog({
  at, members, onImport, onClose,
}: {
  at: { x: number; y: number }; members: { id: string; name: string; color: string }[];
  onImport: (els: BoardElement[]) => void; onClose: () => void;
}) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<CsvMode>("sticky");
  const [hasHeader, setHasHeader] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const read = async (f: File) => {
    setError(null);
    if (f.size > 5 * 1024 * 1024) { setError("That file is over 5 MB."); return; }
    const parsed = parseCsv(await f.text());
    if (!parsed.length) { setError("No rows found in that file."); return; }
    setRows(parsed);
    setFileName(f.name);
    const head = parsed[0].map((h) => h.toLowerCase());
    if (head.some((h) => ["status", "estado", "assignee", "due", "owner"].includes(h))) setMode("card");
  };

  const count = rows ? (mode === "table" ? 1 : Math.min(CSV_LIMITS.rows, rows.length - (hasHeader ? 1 : 0))) : 0;
  const modes: { id: CsvMode; name: string; desc: string }[] = [
    { id: "sticky", name: "Sticky notes", desc: "One note per row" },
    { id: "card", name: "Task cards", desc: "Reads title, status, assignee and due date columns" },
    { id: "table", name: "Table", desc: `Up to ${CSV_LIMITS.tableRows} rows and ${CSV_LIMITS.tableCols} columns` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import CSV</h2>
          <button className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-slate-200 p-4 text-sm text-slate-500 hover:border-brand-300">
          <FileSpreadsheet size={22} />
          {fileName ? <span className="font-medium text-slate-700">{fileName} · {rows?.length} rows</span> : "Choose a .csv or .tsv file (Excel and Google Sheets can export these)"}
          <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
        </label>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {rows && (
          <>
            <div className="max-h-36 overflow-auto rounded-md border border-slate-100 text-xs">
              <table className="w-full">
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className={i === 0 && hasHeader ? "bg-slate-50 font-semibold" : ""}>
                      {r.slice(0, 6).map((c, j) => <td key={j} className="max-w-[10rem] truncate border-b border-slate-100 px-2 py-1">{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> The first row is a header
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              {modes.map((m) => (
                <button key={m.id} type="button" onClick={() => setMode(m.id)}
                  className={`rounded-lg border p-2.5 text-left text-sm ${mode === m.id ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300"}`}>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-slate-500">{m.desc}</div>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!rows || count <= 0}
            onClick={() => { if (rows) onImport(csvToElements(rows, mode, hasHeader, at, members)); }}>
            {mode === "table" ? "Add table" : `Add ${count} ${mode === "card" ? "card" : "note"}${count === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Save as template ────────────────────────────────────────────────────────

export function TemplateDialog({ boardId, title, elements, onDone, onClose }: {
  boardId: string; title: string; elements: BoardElement[]; onDone: (msg: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(title);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form className="card w-full max-w-md space-y-4 p-5" onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveBoardAsTemplate(boardId, { name, description, elements: JSON.stringify(elements) });
          if (r?.error) setError(r.error); else onDone(`Saved “${name.trim()}”. It's now in New board for everyone in this workspace.`);
        });
      }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Save as template</h2>
          <button type="button" className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="text-sm text-slate-500">Everyone in this workspace can start new boards from it. The board's {elements.length} items are copied as they are now.</p>
        <div>
          <label className="label" htmlFor="tpl-name">Name</label>
          <input id="tpl-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} />
        </div>
        <div>
          <label className="label" htmlFor="tpl-desc">Description (optional)</label>
          <input id="tpl-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Client kickoff: brief, site photos, program" maxLength={200} />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pending || !name.trim()}>{pending ? "Saving…" : "Save template"}</button>
        </div>
      </form>
    </div>
  );
}

// ── Version history ─────────────────────────────────────────────────────────

type Version = { id: string; label: string | null; auto: boolean; elementCount: number; createdAt: string; by: string | null };

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `Today, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function VersionPanel({
  boardId, q, api, previewing, onPreview, onRestored, onClose,
}: {
  boardId: string; q: string; api: BoardApi; previewing: string | null;
  onPreview: (v: { id: string; label: string; elements: BoardElement[] } | null) => void;
  onRestored: (msg: string) => void; onClose: () => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/boards/${boardId}/versions`;
  const withQ = (path: string, extra = "") => `${path}${q}${extra ? (q ? "&" : "?") + extra : ""}`;

  const load = async () => {
    const r = await fetch(withQ(base));
    if (r.ok) setVersions((await r.json()).versions); else setError("Couldn't load the history.");
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [boardId]);

  const save = async (name: string) => {
    const r = await fetch(withQ(base, `label=${encodeURIComponent(name)}`), {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Blob([api.encodeState() as BlobPart]),
    });
    if (!r.ok) throw new Error("Couldn't save a version");
  };
  const fetchVersion = async (id: string) => {
    const r = await fetch(withQ(`${base}/${id}`));
    if (!r.ok) throw new Error("Couldn't open that version");
    return ((await r.json()).elements as BoardElement[]).sort((a, b) => a.z - b.z);
  };
  const name = (v: Version) => v.label ?? (v.auto ? "Autosave" : "Saved version");

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(null); }
  };

  return (
    <aside className="absolute right-3 top-16 z-20 flex max-h-[calc(100%-5rem)] w-80 max-w-[calc(100vw-24px)] flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-100 p-3">
        <h2 className="flex items-center gap-2 font-semibold"><History size={16} /> Version history</h2>
        <button className="btn-ghost p-1" onClick={onClose}><X size={16} /></button>
      </div>
      <form className="flex gap-2 border-b border-slate-100 p-3" onSubmit={(e) => {
        e.preventDefault();
        void run("save", async () => { await save(label.trim() || "Saved version"); setLabel(""); await load(); });
      }}>
        <input className="input py-1 text-sm" placeholder="Name this version, e.g. Sent to client" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
        <button className="btn-primary shrink-0 py-1 text-sm" disabled={!!busy}>Save</button>
      </form>
      {error && <p className="px-3 pt-2 text-sm text-rose-600">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!versions ? <p className="p-2 text-sm text-slate-500">Loading…</p>
          : versions.length === 0 ? <p className="p-2 text-sm text-slate-500">No versions yet. The board is saved automatically every 10 minutes while people edit, or save one now.</p>
          : (
            <ol className="space-y-1">
              {versions.map((v) => (
                <li key={v.id} className={`rounded-lg p-2 text-sm ${previewing === v.id ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-slate-50"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${v.auto ? "bg-slate-300" : "bg-brand-500"}`} />
                    <span className={`min-w-0 flex-1 truncate ${v.auto ? "text-slate-600" : "font-medium"}`}>{name(v)}</span>
                    <button className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-800" title="Preview" disabled={!!busy}
                      onClick={() => void run(v.id, async () => onPreview({ id: v.id, label: `${name(v)} · ${when(v.createdAt)}`, elements: await fetchVersion(v.id) }))}>
                      <Eye size={14} />
                    </button>
                    <button className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-800" title="Restore this version" disabled={!!busy}
                      onClick={() => {
                        if (!window.confirm(`Restore “${name(v)}” from ${when(v.createdAt)}? The current board is saved as a version first, so you can go back.`)) return;
                        void run(v.id, async () => {
                          const els = await fetchVersion(v.id);
                          await save(`Before restoring ${when(v.createdAt)}`);
                          api.replaceAll(els);
                          onPreview(null);
                          onRestored(`Restored the version from ${when(v.createdAt)}.`);
                          await load();
                        });
                      }}>
                      <RotateCcw size={14} />
                    </button>
                  </div>
                  <div className="pl-4 text-xs text-slate-500">{when(v.createdAt)}{v.by ? ` · ${v.by}` : ""} · {v.elementCount} items</div>
                </li>
              ))}
            </ol>
          )}
      </div>
    </aside>
  );
}

// ── Board details ───────────────────────────────────────────────────────────

export function DetailsDialog({ title, details, folder, items, frames, sharing, teams, onClose }: {
  title: string; details: { createdBy: string | null; createdAt: string; updatedAt: string };
  folder: string | null; items: number; frames: number; sharing: Sharing | null; teams: { id: string; name: string }[]; onClose: () => void;
}) {
  useEscape(onClose);
  const date = (iso: string) => new Date(iso).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const who = sharing && (sharing.visibility === "WORKSPACE" ? "Everyone in the workspace"
    : sharing.visibility === "TEAM" ? `Team: ${teams.find((t) => t.id === sharing.teamId)?.name ?? "a team"}` : "Only the owner (and admins)");
  const link = sharing && (sharing.linkAccess === "NONE" ? "Off" : sharing.linkAccess === "VIEW" ? "Anyone with the link can view" : "Anyone with the link can edit");
  const rows: [string, string][] = [
    ["Folder", folder ?? "No folder"],
    ["Created by", details.createdBy ?? "Unknown"],
    ["Created", date(details.createdAt)],
    ["Last saved", date(details.updatedAt)],
    ["Items", frames ? `${items}, including ${frames} frame${frames === 1 ? "" : "s"}` : String(items)],
    ...(who ? [["Who can open it", who] as [string, string]] : []),
    ...(link ? [["Share link", link] as [string, string]] : []),
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Board details" className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold"><Info size={18} className="shrink-0" /> <span className="truncate">{title}</span></h2>
          <button className="btn-ghost p-1" onClick={onClose} title="Close"><X size={18} /></button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
