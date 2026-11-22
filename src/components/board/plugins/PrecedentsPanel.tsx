"use client";

import { useRef, useState } from "react";
import { Columns3, ImagePlus, Library } from "lucide-react";
import { makeElement, newId, type BoardElement, type ImageElement, type Precedent } from "@/lib/board/types";
import { PluginPanel, Section, boxOf, type PluginContext } from "./shared";

const caption = (p: Precedent) => [
  [p.title, p.year].filter(Boolean).join(", "),
  p.architect,
  [p.credit && `Photo: ${p.credit}`, p.source].filter(Boolean).join(" · "),
  p.tags.length ? p.tags.map((t) => `#${t}`).join(" ") : "",
].filter(Boolean).join("\n");

export const parseTags = (s: string) => Array.from(new Set(s.split(/[,#]/).map((t) => t.trim().toLowerCase()).filter(Boolean)));

/** Columns by first tag: { tag, items } in the order the tags first appear. */
export function byFirstTag<T extends { meta?: BoardElement["meta"] }>(items: T[]) {
  const cols = new Map<string, T[]>();
  for (const e of items) {
    const t = e.meta?.precedent?.tags[0] ?? "untagged";
    cols.set(t, [...(cols.get(t) ?? []), e]);
  }
  return Array.from(cols, ([tag, list]) => ({ tag, items: list }));
}

/**
 * Precedent clipper plug-in: adds a reference picture with its title, architect, year, source link, photo credit and tags as a
 * caption, lists the board's precedents by tag, and arranges them in columns by tag.
 */
export function PrecedentsPanel({ ctx, onClose }: { ctx: PluginContext; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [p, setP] = useState({ title: "", architect: "", year: "", source: "", credit: "", tags: "" });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const precedents = ctx.elements.filter((e) => e.type === "image" && e.meta?.precedent);
  const tags = Array.from(new Set(precedents.flatMap((e) => e.meta!.precedent!.tags))).sort();
  const shown = filter ? precedents.filter((e) => e.meta!.precedent!.tags.includes(filter)) : precedents;
  const captionOf = (e: BoardElement) => ctx.elements.find((c) => c.id !== e.id && c.groupId && c.groupId === e.groupId);

  const add = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await ctx.upload(file, file.name);
      const img = new window.Image();
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
      const w = 480, h = (img.height / Math.max(1, img.width)) * w;
      const meta: Precedent = {
        title: p.title.trim() || file.name.replace(/\.[^.]+$/, ""), tags: parseTags(p.tags),
        ...(p.architect.trim() && { architect: p.architect.trim() }), ...(p.year.trim() && { year: p.year.trim() }),
        ...(p.source.trim() && { source: p.source.trim() }), ...(p.credit.trim() && { credit: p.credit.trim() }),
      };
      const box = boxOf(precedents.flatMap((e) => [e, captionOf(e)].filter(Boolean) as BoardElement[]));
      const c = ctx.center();
      const x = box ? box.x + box.width + 48 : c.x - w / 2, y = box ? box.y : c.y - h / 2;
      const groupId = newId(), z = Date.now();
      const pic = makeElement("image", x, y, { width: w, height: h, fill: "transparent", stroke: "transparent", z, groupId, meta: { precedent: meta } }) as ImageElement;
      pic.src = url;
      const text = caption(meta);
      const cap = makeElement("text", x, y + h + 10, { width: w, height: 22 * text.split("\n").length + 6, text, fontSize: 14, z: z + 1, groupId });
      ctx.api.add([pic, cap]);
      ctx.focus([pic, cap]);
      setFile(null);
      setP({ ...p, title: "", architect: "", year: "", source: "", credit: "" });
      ctx.toast(`${meta.title} added to the precedents.`);
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : "Couldn't add the picture");
    } finally { setBusy(false); }
  };

  const arrange = () => {
    const cols = byFirstTag(precedents);
    const c = ctx.center(), colW = 480, gap = 64;
    const x0 = c.x - (cols.length * (colW + gap) - gap) / 2;
    const top = (boxOf(precedents)?.y ?? c.y) - 60;
    const patches: { id: string; patch: Partial<BoardElement> }[] = [];
    const heads: BoardElement[] = [];
    const oldHeads = ctx.elements.filter((e) => e.type === "text" && e.meta?.precedent && e.meta.precedent.tags.length === 0 && e.meta.precedent.title.startsWith("#"));
    cols.forEach((col, i) => {
      const x = x0 + i * (colW + gap);
      heads.push(makeElement("text", x, top, { width: colW, height: 40, text: `#${col.tag}`, fontSize: 24, z: Date.now(), meta: { precedent: { title: `#${col.tag}`, tags: [] } } }));
      let y = top + 60;
      for (const e of col.items) {
        const k = colW / e.width, h = e.height * k;
        patches.push({ id: e.id, patch: { x, y, width: colW, height: h } });
        const cap = captionOf(e);
        if (cap) { patches.push({ id: cap.id, patch: { x, y: y + h + 10, width: colW } }); y += h + 10 + cap.height; } else y += h;
        y += gap;
      }
    });
    if (oldHeads.length) ctx.api.remove(oldHeads.map((e) => e.id));
    ctx.api.updateMany(patches);
    ctx.api.add(heads);
    const moved = new Map(patches.map((q) => [q.id, q.patch]));
    ctx.focus([...heads, ...precedents.map((e) => ({ ...e, ...moved.get(e.id) }) as BoardElement)]);
    ctx.toast(`Arranged in ${cols.length} column${cols.length > 1 ? "s" : ""} by tag.`);
  };

  const input = (k: keyof typeof p, label: string) => (
    <input className="input py-1.5" placeholder={label} aria-label={label} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
  );
  return (
    <PluginPanel icon={Library} title="Precedents" onClose={onClose}>
      <Section title="Clip a precedent" hint="A picture with where it's from and who took it, so the credit travels with it.">
        <button className={`btn-outline w-full ${file ? "border-rose-400" : ""}`} onClick={() => fileRef.current?.click()}>
          <ImagePlus size={15} /> <span className="truncate">{file ? file.name : "Choose a picture"}</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        {input("title", "Project")}
        <div className="flex gap-1">{input("architect", "Architect")}<div className="w-24 shrink-0">{input("year", "Year")}</div></div>
        {input("source", "Source link")}
        {input("credit", "Photo credit")}
        {input("tags", "Tags: courtyard, timber, facade")}
        <button className="btn-primary w-full" disabled={!file || busy} onClick={add}>{busy ? "Uploading…" : "Add to the board"}</button>
      </Section>

      <Section title="On this board" divided hint={precedents.length ? `${precedents.length} precedent${precedents.length > 1 ? "s" : ""}.` : "None yet."}>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <button key={t} onClick={() => setFilter(filter === t ? null : t)}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${filter === t ? "border-rose-700 bg-rose-700 text-white" : "border-slate-200 hover:bg-slate-50"}`}>#{t}</button>
            ))}
          </div>
        )}
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
          {shown.map((e) => (
            <li key={e.id}>
              <button className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-slate-100" onClick={() => { ctx.select([e.id]); ctx.focus([e]); }}>
                {e.meta!.precedent!.title}{e.meta!.precedent!.architect ? ` · ${e.meta!.precedent!.architect}` : ""}
              </button>
            </li>
          ))}
        </ul>
        <button className="btn-outline w-full" disabled={!precedents.length} onClick={arrange}><Columns3 size={15} /> Arrange in columns by tag</button>
      </Section>
    </PluginPanel>
  );
}
