"use client";

import { useState } from "react";
import { Download, Loader2, Network, Send } from "lucide-react";
import { makeElement, type BoardElement, type ConnectorElement, type RoomBrief } from "@/lib/board/types";
import { DEFAULT_PX_PER_METER } from "@/lib/board/arch";
import { adjacencyCsv, bubbleDiagram, bubbleDiameter, downloadText, parseProgram, programCsv } from "@/lib/board/plugins";
import { PluginPanel, Section, boxOf, type PluginContext } from "./shared";
import { KeystoneTarget, useKeystoneProjects } from "./KeystoneTarget";

const GROUP_COLORS = ["#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8", "#ddd6fe", "#fed7aa", "#e5e7eb"];
export const RELATIONS: { w: 3 | 1 | -1; label: string; stroke: string; pattern: "solid" | "dashed" | "dotted" }[] = [
  { w: 3, label: "Must be next to", stroke: "#0f172a", pattern: "solid" },
  { w: 1, label: "Nice to be near", stroke: "#0f766e", pattern: "dashed" },
  { w: -1, label: "Keep apart", stroke: "#dc2626", pattern: "dotted" },
];

const EXAMPLE = "Entrance and public\nFoyer; 1; 220\nCafeteria; 1; 160\nSeminar room; 4; 60\nOffices\nSingle office; 24; 12,5\nMeeting room; 6; 25";

export const bubbleLabel = (r: RoomBrief) => `${r.name}\n${r.count && r.count > 1 ? `${r.count} × ${r.area} m²` : `${r.area} m²`}`;

/**
 * Bubble diagram plug-in: a room program becomes bubbles sized to their area at the board's scale, colored by group. Selected
 * bubbles can be linked as "must be next to", "nice to be near" or "keep apart", and the whole diagram downloads as the room
 * program and adjacency matrix Keystone reads, to drive its massing.
 */
export function BubblePanel({ ctx, onClose }: { ctx: PluginContext; onClose: () => void }) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseProgram(text) : [];
  const { rooms, bubbles, relations } = bubbleDiagram(ctx.elements);
  const selBubbles = ctx.selected.filter((e) => e.meta?.room);
  const pxPerM = ctx.boardScale ? 1 / ctx.boardScale.metersPerPx : DEFAULT_PX_PER_METER;

  const addBubbles = () => {
    const groups = Array.from(new Set(parsed.map((r) => r.group ?? "")));
    const sized = parsed.map((r) => ({ r, d: bubbleDiameter(r.area * (r.count ?? 1), pxPerM) }));
    const total = sized.reduce((s, b) => s + b.d * b.d, 0);
    const rowWidth = Math.max(Math.sqrt(total) * 1.6, ...sized.map((b) => b.d));
    // room between bubbles, so the links between them show
    const gap = Math.max(pxPerM * 1.5, (sized.reduce((t, b) => t + b.d, 0) / Math.max(1, sized.length)) * 0.45);
    const c = ctx.center();
    let x = 0, y = 0, rowH = 0;
    const placed: BoardElement[] = [];
    sized.forEach(({ r, d }, i) => {
      if (x > 0 && x + d > rowWidth) { x = 0; y += rowH + gap; rowH = 0; }
      placed.push(makeElement("ellipse", x, y, {
        width: d, height: d, fill: GROUP_COLORS[groups.indexOf(r.group ?? "") % GROUP_COLORS.length], stroke: "#475569",
        text: bubbleLabel(r), fontSize: Math.max(12, Math.min(28, d / 9)), z: Date.now() + i, meta: { room: r },
      }));
      x += d + gap; rowH = Math.max(rowH, d);
    });
    const w = Math.max(...placed.map((e) => e.x + e.width)), h = y + rowH;
    // right of what is on the board, else in the middle of the view
    const all = boxOf(ctx.elements);
    const ox = all ? all.x + all.width + gap * 2 : c.x - w / 2, oy = all ? all.y : c.y - h / 2;
    placed.forEach((e) => { e.x += ox; e.y += oy; });
    ctx.api.add(placed);
    ctx.select(placed.map((e) => e.id));
    ctx.focus(placed);
    setText("");
    ctx.toast(`${placed.length} room bubbles added${ctx.boardScale ? " at the board's scale" : ""}. Select two and link them below.`);
  };

  const relate = (w: 3 | 1 | -1) => {
    const rel = RELATIONS.find((r) => r.w === w)!;
    const pairs: [BoardElement, BoardElement][] = [];
    for (let i = 0; i < selBubbles.length; i++) for (let j = i + 1; j < selBubbles.length; j++) pairs.push([selBubbles[i], selBubbles[j]]);
    // a pair has one relation: replace what was there
    const old = ctx.elements.filter((e) => {
      if (e.type !== "connector" || !e.meta?.adjacency) return false;
      const c = e as ConnectorElement;
      return pairs.some(([a, b]) => (c.from.id === a.id && c.to.id === b.id) || (c.from.id === b.id && c.to.id === a.id));
    });
    if (old.length) ctx.api.remove(old.map((e) => e.id));
    const links = pairs.map(([a, b]) => Object.assign(makeElement("connector", 0, 0) as ConnectorElement, {
      width: 0, height: 0, stroke: rel.stroke, pattern: rel.pattern, arrowEnd: false, arrowStart: false, style: "straight" as const,
      from: { id: a.id, x: a.x + a.width / 2, y: a.y + a.height / 2 }, to: { id: b.id, x: b.x + b.width / 2, y: b.y + b.height / 2 },
      z: Date.now(), meta: { adjacency: w }, weight: Math.max(2, Math.min(a.width, b.width) / (w === 3 ? 30 : 45)),
    }));
    ctx.api.add(links);
    ctx.toast(`${rel.label}: ${links.length} link${links.length > 1 ? "s" : ""}.`);
  };

  const download = () => {
    const name = ctx.boardTitle.replace(/[^\w\- ]+/g, "").trim() || "board";
    downloadText(`${name} - room program.csv`, programCsv(rooms, `Room program ${ctx.boardTitle}`));
    if (relations.length) setTimeout(() => downloadText(`${name} - adjacency.csv`, adjacencyCsv(rooms, relations)), 300);
  };

  const ks = useKeystoneProjects();
  const [project, setProject] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ text: string; url?: string; error?: boolean } | null>(null);
  const send = async () => {
    const p = ks.state?.projects.find((x) => x.id === project);
    if (!p) return;
    setSending(true); setSent(null);
    try {
      const r = await fetch(`/api/keystone/projects/${encodeURIComponent(p.id)}/program`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ boardId: ctx.boardId, program: programCsv(rooms, `Bubble diagram · ${ctx.boardTitle}`), adjacency: relations.length ? adjacencyCsv(rooms, relations) : "" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setSent({ text: j.error ?? "Keystone didn't take the program", error: true }); if (j.needsConnect) void ks.reload(); return; }
      setSent({ text: `${p.name} has the program now: ${j.rooms} room type${j.rooms === 1 ? "" : "s"}, ${j.relations} relation${j.relations === 1 ? "" : "s"}.`, url: j.url });
      ctx.toast(`Sent to Keystone: ${p.name}`);
    } catch { setSent({ text: "Couldn't reach Keystone. Try again", error: true }); } finally { setSending(false); }
  };

  const total = rooms.reduce((s, r) => s + r.area * (r.count ?? 1), 0);
  return (
    <PluginPanel icon={Network} title="Bubble diagram" onClose={onClose}>
      <Section title="Room program" hint={<>One room a line: <code>Name; area</code> or <code>Name; count; m² each</code>. A line without numbers starts a group. You can paste Keystone&apos;s program files too.</>}>
        <textarea className="input h-32 font-mono text-xs" placeholder={EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} aria-label="Room program" />
        <button className="btn-primary w-full" disabled={!parsed.length} onClick={addBubbles}>
          {parsed.length ? `Add ${parsed.length} bubble${parsed.length > 1 ? "s" : ""}` : "Paste or type the rooms"}
        </button>
        {!ctx.boardScale && <p className="text-[11px] text-slate-400">No board scale yet: bubbles are drawn at 1 m = {DEFAULT_PX_PER_METER} px.</p>}
      </Section>

      <Section title="Relations" divided hint={selBubbles.length < 2 ? "Select two or more bubbles to link them." : `${selBubbles.length} bubbles selected.`}>
        <div className="grid gap-1">
          {RELATIONS.map((r) => (
            <button key={r.w} className="btn-outline justify-start" disabled={selBubbles.length < 2} onClick={() => relate(r.w)}>
              <svg width="28" height="8" aria-hidden><line x1="0" y1="4" x2="28" y2="4" stroke={r.stroke} strokeWidth="2.5"
                strokeDasharray={r.pattern === "dashed" ? "6 4" : r.pattern === "dotted" ? "1.5 4" : undefined} strokeLinecap="round" /></svg>
              {r.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="For Keystone" divided
        hint={bubbles.length ? `${rooms.length} room types, ${Math.round(total)} m² in all, ${relations.length} relation${relations.length === 1 ? "" : "s"}.` : "Add bubbles first."}>
        <KeystoneTarget k={ks} value={project} onChange={setProject} />
        {ks.state?.connected && !!ks.state.projects.length && (
          <button className="btn-primary w-full" disabled={!bubbles.length || !project || sending} onClick={send}>
            {sending ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : <><Send size={15} /> Send to Keystone</>}
          </button>
        )}
        {sent && (
          <p className={`text-xs ${sent.error ? "text-rose-600" : "text-emerald-700"}`}>
            {sent.text} {sent.url && <a className="underline" href={sent.url} target="_blank" rel="noopener noreferrer">Open in Keystone</a>}
          </p>
        )}
        <p className="text-[11px] text-slate-400">It becomes the project&apos;s room program, with the relations as its adjacency matrix, so Massing can lay it out. The project&apos;s rooms are replaced; its site and settings stay.</p>
        <button className="btn-ghost w-full text-xs" disabled={!bubbles.length} onClick={download}><Download size={14} /> Or download the two CSV files</button>
      </Section>
    </PluginPanel>
  );
}
