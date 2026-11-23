"use client";

import { useState } from "react";
import { ClipboardList, RefreshCw, Tag } from "lucide-react";
import { makeElement, type BoardElement } from "@/lib/board/types";
import { formatArea } from "@/lib/board/arch";
import { briefFor, bubbleDiagram, isRoomShape, roomArea } from "@/lib/board/plugins";
import { boxOf, PluginPanel, Section, upsertTable, type PluginContext } from "./shared";

const tagText = (name: string, m2: number | null, unit: PluginContext["unit"]) => `${name}\n${m2 == null ? "no scale" : formatArea(m2, unit)}`;

/** Rows of the room schedule: each tagged room, its measured area, the brief from the bubble diagram and the difference. */
export function roomSchedule(ctx: Pick<PluginContext, "elements" | "boardScale" | "unit">) {
  const { rooms } = bubbleDiagram(ctx.elements);
  const byId = new Map(ctx.elements.map((e) => [e.id, e]));
  const tags = ctx.elements.filter((e) => e.meta?.tagOf && byId.has(e.meta.tagOf));
  const rows = tags.map((t) => {
    const name = t.meta!.roomName ?? "Room";
    const m2 = roomArea(byId.get(t.meta!.tagOf!)!, ctx.elements, ctx.boardScale);
    return { tag: t, name, m2, brief: briefFor(name, rooms) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const fmt = (n: number | null) => (n == null ? "–" : formatArea(n, ctx.unit));
  const diff = (m2: number | null, brief: number | null) => {
    if (m2 == null || brief == null) return "";
    const d = m2 - brief, pct = Math.round((d / brief) * 100);
    return `${d >= 0 ? "+" : "−"}${formatArea(Math.abs(d), ctx.unit)}, ${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%${Math.abs(pct) > 10 ? (d > 0 ? " over" : " under") : ""}`;
  };
  const total = rows.reduce((s, r) => s + (r.m2 ?? 0), 0);
  const briefTotal = rows.reduce((s, r) => s + (r.brief ?? 0), 0);
  const cells = [["Room", "Area", "Brief", "Difference"], ...rows.map((r) => [r.name, fmt(r.m2), fmt(r.brief), diff(r.m2, r.brief)]),
    ["Total", formatArea(total, ctx.unit), briefTotal ? formatArea(briefTotal, ctx.unit) : "–", briefTotal ? diff(total, briefTotal) : ""]];
  return { rows, cells };
}

/**
 * Room tags plug-in: name a measured area or a closed wall and its tag shows the room's area at the plan's scale. A room
 * schedule table lists the tagged rooms with their area, the brief from the bubble diagram (same name) and how far off they are.
 */
export function RoomsPanel({ ctx, onClose }: { ctx: PluginContext; onClose: () => void }) {
  const [name, setName] = useState("");
  const shapes = ctx.selected.filter((e) => isRoomShape(e) && !e.meta?.room);
  const allShapes = ctx.elements.filter((e) => isRoomShape(e) && !e.meta?.room);
  const tagged = new Set(ctx.elements.filter((e) => e.meta?.tagOf).map((e) => e.meta!.tagOf!));
  const untagged = allShapes.filter((e) => !tagged.has(e.id)).length;
  const { rooms } = bubbleDiagram(ctx.elements);
  const names = Array.from(new Set(rooms.map((r) => r.name)));

  const tag = () => {
    const n = name.trim();
    if (!n || !shapes.length) return;
    const add: BoardElement[] = [], patches: { id: string; patch: Partial<BoardElement> }[] = [];
    shapes.forEach((s, i) => {
      const label = shapes.length > 1 ? `${n} ${i + 1}` : n;
      const text = tagText(label, roomArea(s, ctx.elements, ctx.boardScale), ctx.unit);
      const existing = ctx.elements.find((e) => e.meta?.tagOf === s.id);
      if (existing) { patches.push({ id: existing.id, patch: { text, meta: { tagOf: s.id, roomName: label } } }); return; }
      // above the middle, clear of the area's own measurement label
      add.push(makeElement("text", s.x + s.width / 2 - 90, s.y + s.height / 2 - 92, {
        width: 180, height: 56, text, fontSize: 18, align: "center", z: Date.now() + i, meta: { tagOf: s.id, roomName: label },
      }));
    });
    if (patches.length) ctx.api.updateMany(patches);
    if (add.length) ctx.api.add(add);
    setName("");
    ctx.toast(`Tagged ${shapes.length} room${shapes.length > 1 ? "s" : ""}. Update the schedule to list ${shapes.length > 1 ? "them" : "it"}.`);
  };

  const update = () => {
    const { rows, cells } = roomSchedule(ctx);
    if (!rows.length) { ctx.toast("Tag some rooms first."); return; }
    ctx.api.updateMany(rows.map((r) => ({ id: r.tag.id, patch: { text: tagText(r.name, r.m2, ctx.unit) } })));
    const near = boxOf(rows.map((r) => ctx.elements.find((e) => e.id === r.tag.meta!.tagOf)!));
    const id = upsertTable(ctx, "rooms", cells, 760, near);
    ctx.select([id]);
    ctx.toast(`Room schedule updated: ${rows.length} room${rows.length > 1 ? "s" : ""}.`);
  };

  return (
    <PluginPanel icon={ClipboardList} title="Room schedule" onClose={onClose}>
      <Section title="Tag a room" hint={shapes.length ? `${shapes.length} room shape${shapes.length > 1 ? "s" : ""} selected.`
        : "Select a measured area or a closed wall (draw them with the Area and Wall tools), then name it."}>
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); tag(); }}>
          <input className="input" list="room-names" placeholder="Kitchen" value={name} onChange={(e) => setName(e.target.value)} aria-label="Room name" />
          <datalist id="room-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
          <button className="btn-primary px-3" disabled={!shapes.length || !name.trim()} title="Tag"><Tag size={15} /></button>
        </form>
        {names.length > 0 && <p className="text-[11px] text-slate-400">Use a room name from the bubble diagram to compare it with the brief.</p>}
      </Section>
      <Section title="Schedule" divided hint={`${tagged.size} tagged room${tagged.size === 1 ? "" : "s"}${untagged ? `, ${untagged} room shape${untagged > 1 ? "s" : ""} not tagged yet` : ""}. Walls count to their centerline.`}>
        <button className="btn-outline w-full" disabled={!tagged.size} onClick={update}><RefreshCw size={15} /> Update tags and schedule</button>
        <p className="text-[11px] text-slate-400">Rooms more than 10% off their brief are marked over or under.</p>
      </Section>
    </PluginPanel>
  );
}
