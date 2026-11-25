"use client";

import { useState } from "react";
import { CheckCircle2, HelpCircle, LayoutGrid, Loader2, PenLine, Presentation, Send } from "lucide-react";
import { makeElement, type BoardElement, type ImageElement, type TableElement, type Verdict } from "@/lib/board/types";
import { PluginPanel, Section, boxOf, today, upsertTable, type PluginContext } from "./shared";
import { KeystoneTarget, useKeystoneProjects } from "./KeystoneTarget";

export const VERDICTS: { id: Verdict; label: string; stamp: string; color: string; icon: typeof CheckCircle2 }[] = [
  { id: "approved", label: "Approve", stamp: "APPROVED", color: "#16a34a", icon: CheckCircle2 },
  { id: "revise", label: "Revise", stamp: "REVISE", color: "#dc2626", icon: PenLine },
  { id: "question", label: "Question", stamp: "QUESTION", color: "#d97706", icon: HelpCircle },
];

const sheetName = (e: BoardElement) =>
  e.type === "image" && (e as ImageElement).plan ? `${(e as ImageElement).plan!.name}${(e as ImageElement).plan!.page ? ` p. ${(e as ImageElement).plan!.page}` : ""}`
    : (e.text ?? "").split("\n")[0].slice(0, 40) || (e.type === "image" ? "Picture" : "Sheet");

const inside = (c: BoardElement, f: BoardElement) => c.id !== f.id && c.type !== "connector" &&
  c.x >= f.x && c.y >= f.y && c.x + c.width <= f.x + f.width && c.y + c.height <= f.y + f.height;

const overlaps = (a: BoardElement, b: BoardElement) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The markup on a sheet: what lies over it (redlines, clouds, notes, stamps), the box that takes it all in, and its notes in
 * reading order ("Revise: widen the corridor" for a stamp). Frames and other sheets under it are not markup.
 */
export function markupOn(sheet: BoardElement, elements: BoardElement[]) {
  const on = elements.filter((e) => e.id !== sheet.id && e.type !== "frame" && e.type !== "connector" && !(e.type === "image" && e.z <= sheet.z)
    && (e.meta?.stamp ? e.meta.stamp.of === sheet.id : overlaps(e, sheet) && e.z > sheet.z));
  const notes = [...on].sort((a, b) => (Math.abs(a.y - b.y) > 20 ? a.y - b.y : a.x - b.x)).flatMap((e) => {
    if (e.meta?.stamp) {
      const v = VERDICTS.find((x) => x.id === e.meta!.stamp!.verdict);
      const rest = (e.text ?? "").split("\n").slice(1).join(" ").trim();
      return [`${v ? v.label === "Approve" ? "Approved" : v.label : "Stamp"}${rest ? `: ${rest}` : ""}`];
    }
    const t = (e.text ?? "").replace(/\s+/g, " ").trim();
    return t ? [t] : [];
  });
  const all = [sheet, ...on];
  const x0 = Math.min(...all.map((e) => e.x)), y0 = Math.min(...all.map((e) => e.y));
  const x1 = Math.max(...all.map((e) => e.x + e.width)), y1 = Math.max(...all.map((e) => e.y + e.height));
  const pad = Math.max(sheet.width, sheet.height) * 0.02;
  return { marks: on, notes: Array.from(new Set(notes)).slice(0, 50), rect: { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad } };
}

/** The Keystone project a sheet came from: its own tag, else the frame it was sent in. */
export function keystoneOf(sheet: BoardElement, elements: BoardElement[]) {
  if (sheet.meta?.keystone) return sheet.meta.keystone;
  const f = elements.find((e) => e.type === "frame" && e.meta?.keystone && sheet.x >= e.x && sheet.y >= e.y && sheet.x + sheet.width <= e.x + e.width && sheet.y + sheet.height <= e.y + e.height);
  return f?.meta?.keystone ?? null;
}

/** Grid positions (left to right, top to bottom) for items of these sizes, `gap` apart, in about a 3:2 wall. */
export function wallLayout(sizes: { width: number; height: number }[], gap: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(sizes.length * 1.5)));
  const pos: { x: number; y: number }[] = [];
  let y = 0;
  for (let r = 0; r * cols < sizes.length; r++) {
    const row = sizes.slice(r * cols, (r + 1) * cols);
    let x = 0;
    row.forEach((s) => { pos.push({ x, y }); x += s.width + gap; });
    y += Math.max(...row.map((s) => s.height)) + gap;
  }
  return pos;
}

/**
 * Crit wall plug-in: pins the selected sheets up as a wall in a frame of its own, stamps sheets Approved / Revise / Question
 * with a note, and keeps a decision log table of every stamp (date, sheet, verdict, note, who).
 */
export function CritPanel({ ctx, onClose, onPresent }: { ctx: PluginContext; onClose: () => void; onPresent: () => void }) {
  const [note, setNote] = useState("");
  const sheets = ctx.selected.filter((e) => e.type !== "connector" && !e.meta?.stamp);

  const pinUp = () => {
    const items = [...sheets].sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
    const gap = Math.max(60, Math.min(...items.map((e) => Math.min(e.width, e.height))) * 0.12);
    const pos = wallLayout(items, gap);
    const c = ctx.center();
    const w = Math.max(...pos.map((p, i) => p.x + items[i].width)), h = Math.max(...pos.map((p, i) => p.y + items[i].height));
    const pad = gap, top = gap * 1.2;
    const x0 = c.x - w / 2, y0 = c.y - h / 2;
    const patches: { id: string; patch: Partial<BoardElement> }[] = [];
    items.forEach((e, i) => {
      const dx = x0 + pos[i].x - e.x, dy = y0 + pos[i].y - e.y;
      patches.push({ id: e.id, patch: { x: e.x + dx, y: e.y + dy } });
      // a frame takes what is in it along
      if (e.type === "frame") ctx.elements.filter((ch) => inside(ch, e) && !items.includes(ch)).forEach((ch) => patches.push({ id: ch.id, patch: { x: ch.x + dx, y: ch.y + dy } }));
      // and a sheet its stamps
      ctx.elements.filter((s) => s.meta?.stamp?.of === e.id).forEach((s) => patches.push({ id: s.id, patch: { x: s.x + dx, y: s.y + dy } }));
    });
    ctx.api.updateMany(patches);
    // under the sheets: imported plans sit below everything else
    const z = Math.min(0, ...ctx.elements.map((e) => e.z)) - 1;
    const frame = makeElement("frame", x0 - pad, y0 - top, { width: w + pad * 2, height: h + pad + top, text: `Crit wall · ${today()}`, z });
    ctx.api.add([frame]);
    ctx.select([frame.id]);
    ctx.focus([frame]);
    ctx.toast(`${items.length} sheets pinned up. Select one to stamp it.`);
  };

  const stamp = (v: Verdict) => {
    const V = VERDICTS.find((x) => x.id === v)!;
    const old = ctx.elements.filter((e) => e.meta?.stamp && sheets.some((s) => s.id === e.meta!.stamp!.of));
    if (old.length) ctx.api.remove(old.map((e) => e.id));
    const z = Date.now();
    const stamps = sheets.map((s, i) => {
      const w = Math.max(150, Math.min(640, s.width * 0.3)), h = w * 0.3;
      return makeElement("rect", s.x + s.width - w - w * 0.08, s.y + h * 0.4, {
        width: w, height: h, rotation: -8, fill: `${V.color}1f`, stroke: V.color, text: note.trim() ? `${V.stamp}\n${note.trim()}` : V.stamp,
        fontSize: Math.round(h * (note.trim() ? 0.24 : 0.4)), font: "condensed", z: z + i, meta: { stamp: { verdict: v, of: s.id } },
      });
    });
    ctx.api.add(stamps);
    // the decision log
    const log = ctx.elements.find((e) => e.type === "table" && e.meta?.table === "decisions") as TableElement | undefined;
    const head = [["Date", "Sheet", "Verdict", "Note", "By"]];
    const rows = sheets.map((s) => [today(), sheetName(s), V.stamp.charAt(0) + V.stamp.slice(1).toLowerCase(), note.trim(), ctx.user?.name ?? ""]);
    const cells = log ? [...log.cells.filter((r) => r.some((c) => c)), ...rows] : [...head, ...rows];
    const wall = ctx.elements.find((e) => e.type === "frame" && (e.text ?? "").startsWith("Crit wall"));
    const near = wall ?? boxOf(sheets);
    upsertTable(ctx, "decisions", cells, 720, near, Math.max(1, Math.min(4, (near?.height ?? 0) / 450)));
    setNote("");
    ctx.toast(`${V.stamp.charAt(0) + V.stamp.slice(1).toLowerCase()}: ${sheets.length} sheet${sheets.length > 1 ? "s" : ""}, written to the decision log.`);
  };

  // ---------- markup back to Keystone ----------
  const ks = useKeystoneProjects();
  const [project, setProject] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<{ text: string; url?: string; error?: boolean } | null>(null);
  const toSend = sheets.filter((e) => e.type === "image" || e.type === "frame");
  const from = toSend.map((e) => keystoneOf(e, ctx.elements)).find(Boolean) ?? null;
  const sendMarkup = async () => {
    const p = ks.state?.projects.find((x) => x.id === project);
    if (!p || !toSend.length) return;
    setSent(null);
    let done = 0, open: number | null = null, url: string | undefined;
    try {
      for (const [i, sh] of toSend.entries()) {
        setSending(toSend.length > 1 ? `Sending ${i + 1} of ${toSend.length}…` : "Sending…");
        const m = markupOn(sh, ctx.elements);
        // about 2400 pixels across, sharp enough to read the redlines
        const blob = await ctx.exportImage(m.rect, Math.min(4, 2400 / Math.max(m.rect.width, m.rect.height)), "image/jpeg");
        if (!blob) throw new Error("Couldn't draw the sheet");
        const f = new FormData();
        f.append("boardId", ctx.boardId);
        f.append("image", blob, "markup.jpg");
        f.append("sheet", keystoneOf(sh, ctx.elements)?.sheet ?? sheetName(sh));
        f.append("notes", JSON.stringify(m.notes));
        const r = await fetch(`/api/keystone/projects/${encodeURIComponent(p.id)}/markup`, { method: "POST", body: f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { if (j.needsConnect) void ks.reload(); throw new Error(j.error ?? "Keystone didn't take the markup"); }
        open = j.open ?? open; url = j.url ?? url; done++;
      }
      ctx.api.updateMany(toSend.map((e) => ({ id: e.id, patch: { meta: { ...e.meta, sentToKeystone: new Date().toISOString() } } })));
      setSent({ text: `${done} sheet${done > 1 ? "s" : ""} sent to ${p.name}${open != null ? `: ${open} open review item${open === 1 ? "" : "s"} there` : ""}.`, url });
      ctx.toast(`Markup sent to Keystone: ${p.name}`);
    } catch (e) {
      setSent({ text: `${done ? `${done} sent, then: ` : ""}${e instanceof Error ? e.message : "Couldn't reach Keystone. Try again"}`, error: true });
    } finally { setSending(null); }
  };
  const lastSent = toSend.map((e) => e.meta?.sentToKeystone).filter(Boolean).sort().pop();

  return (
    <PluginPanel icon={LayoutGrid} title="Crit wall" onClose={onClose}>
      <Section title="Pin up" hint="Select the sheets, plans or frames to review. They go up as a wall in a frame of their own, in reading order.">
        <button className="btn-primary w-full" disabled={sheets.length < 2} onClick={pinUp}>{sheets.length < 2 ? "Select at least two sheets" : `Pin up ${sheets.length} sheets`}</button>
      </Section>
      <Section title="Stamp" divided hint={sheets.length ? `${sheets.length} sheet${sheets.length > 1 ? "s" : ""} selected.` : "Select a sheet to stamp it."}>
        <input className="input py-1.5" placeholder="Note (optional): what to change, who asked" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        <div className="grid grid-cols-3 gap-1">
          {VERDICTS.map((v) => (
            <button key={v.id} className="btn-outline flex-col gap-0.5 px-1 py-2 text-xs" disabled={!sheets.length} onClick={() => stamp(v.id)} style={{ color: v.color }}>
              <v.icon size={16} /> {v.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">A new stamp replaces the sheet&apos;s last one; the decision log keeps them all.</p>
      </Section>
      <Section title="Send markup to Keystone" divided
        hint={toSend.length ? `${toSend.length} sheet${toSend.length > 1 ? "s" : ""} with the redlines, notes and stamps on ${toSend.length > 1 ? "them" : "it"}.` : "Select the marked-up sheets."}>
        <KeystoneTarget k={ks} value={project} onChange={setProject} fixed={from} />
        {ks.state?.connected && !!ks.state.projects.length && (
          <button className="btn-primary w-full" disabled={!toSend.length || !project || !!sending} onClick={sendMarkup}>
            {sending ? <><Loader2 size={15} className="animate-spin" /> {sending}</> : <><Send size={15} /> Send markup to Keystone</>}
          </button>
        )}
        {sent && (
          <p className={`text-xs ${sent.error ? "text-rose-600" : "text-emerald-700"}`}>
            {sent.text} {sent.url && <a className="underline" href={sent.url} target="_blank" rel="noopener noreferrer">Open in Keystone</a>}
          </p>
        )}
        <p className="text-[11px] text-slate-400">
          Each sheet arrives as a review item in the project&apos;s Team page, with a picture of the markup and its notes, to mark as done there.
          {lastSent && ` Last sent ${new Date(lastSent).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`}
        </p>
      </Section>
      <Section title="Present" divided hint="Frames become slides; the crit wall is one of them.">
        <button className="btn-outline w-full" onClick={onPresent}><Presentation size={15} /> Present the board</button>
      </Section>
    </PluginPanel>
  );
}
