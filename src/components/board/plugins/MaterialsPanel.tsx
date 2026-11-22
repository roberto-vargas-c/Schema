"use client";

import { useRef, useState } from "react";
import { ImagePlus, Palette, RefreshCw, Tag } from "lucide-react";
import { makeElement, newId, type BoardElement, type ImageElement, type Material } from "@/lib/board/types";
import { PluginPanel, Section, boxOf, upsertTable, type PluginContext } from "./shared";

/** A starting set; every field can be changed before the swatch goes on the board. */
export const MATERIAL_LIBRARY: Omit<Material, "code">[] = [
  { name: "Oak flooring", finish: "Oiled, natural", color: "#c8a26b" },
  { name: "Polished concrete", finish: "Sealed, matt", color: "#a8a29e" },
  { name: "Terrazzo", finish: "Honed", color: "#e7e1d7" },
  { name: "Facing brick", finish: "Red, flush joint", color: "#a4523a" },
  { name: "Lime plaster", finish: "Smooth, white", color: "#f3efe6" },
  { name: "Brushed steel", finish: "Satin", color: "#9ca3af" },
  { name: "Ceramic tile", finish: "Glazed, 20 × 20", color: "#93c5fd" },
  { name: "Cork", finish: "Natural", color: "#b7895a" },
];

const nextCode = (els: BoardElement[]) => {
  const used = new Set(els.map((e) => e.meta?.material?.code));
  for (let i = 1; ; i++) { const c = `M${String(i).padStart(2, "0")}`; if (!used.has(c)) return c; }
};
const costText = (m: Material) => (m.cost ? `${m.cost.toLocaleString()} /m²` : "");

/** Rows of the finishes schedule: every material on the board and how many tags place it. */
export function finishesSchedule(elements: BoardElement[]) {
  const mats = elements.filter((e) => e.meta?.material).map((e) => e.meta!.material!).sort((a, b) => a.code.localeCompare(b.code));
  const uses = (code: string) => elements.filter((e) => e.meta?.materialTag === code).length;
  return [["Code", "Material", "Finish", "Supplier", "Cost", "Tags"], ...mats.map((m) => [m.code, m.name, m.finish ?? "", m.supplier ?? "", costText(m), String(uses(m.code))])];
}

/**
 * Material boards plug-in: swatches (a color or a photo) that carry a material's finish, supplier and cost; tags that place a
 * material on a plan or render; and a finishes schedule listing every material with how often it is used.
 */
export function MaterialsPanel({ ctx, onClose }: { ctx: PluginContext; onClose: () => void }) {
  const [m, setM] = useState<Omit<Material, "code">>(MATERIAL_LIBRARY[0]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mats = ctx.elements.filter((e) => e.meta?.material).map((e) => e.meta!.material!);
  const [tagCode, setTagCode] = useState("");
  const targets = ctx.selected.filter((e) => !e.meta?.material && !e.meta?.materialTag);

  const addSwatch = async () => {
    setBusy(true);
    try {
      const mat: Material = { ...m, code: nextCode(ctx.elements), name: m.name.trim() || "Material" };
      const c = ctx.center(), z = Date.now(), groupId = newId();
      // a new swatch goes to the right of the others, so a material board builds up in a row
      const others = ctx.elements.filter((e) => e.meta?.material);
      // the first one goes right of everything on the board, so it doesn't land on a plan
      const box = boxOf(others), all = boxOf(ctx.elements);
      const x = box ? box.x + box.width + 40 * (others[0].width / 220) : all ? all.x + all.width + 120 : c.x - 110;
      const y = box ? box.y : all ? all.y : c.y - 150;
      // swatches keep to the size of the first one, which is sized to what is on the board
      const S = others.length ? others[0].width : Math.round(Math.max(220, Math.min(600, (all?.height ?? 0) / 4)));
      const k = S / 220;
      let swatch: BoardElement;
      if (photo) {
        const url = await ctx.upload(photo, photo.name);
        swatch = makeElement("image", x, y, { width: S, height: S, fill: "transparent", stroke: "transparent", z, groupId, meta: { material: mat } });
        (swatch as ImageElement).src = url;
      } else {
        swatch = makeElement("rect", x, y, { width: S, height: S, fill: mat.color, stroke: "#cbd5e1", text: "", z, groupId, meta: { material: mat } });
      }
      const lines = [`${mat.code} · ${mat.name}`, mat.finish, mat.supplier, costText(mat)].filter(Boolean) as string[];
      const caption = makeElement("text", x, y + S + 12 * k, {
        width: S, height: lines.length * 22 * k + 8, fontSize: Math.round(15 * k), z: z + 1, groupId, text: lines.join("\n"),
      });
      ctx.api.add([swatch, caption]);
      ctx.select([swatch.id, caption.id]);
      ctx.focus([swatch, caption]);
      setPhoto(null);
      setTagCode(mat.code);
      ctx.toast(`${mat.code} ${mat.name} added. Select parts of a plan or render and tag them with it.`);
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : "Couldn't add the swatch");
    } finally { setBusy(false); }
  };

  const tag = () => {
    const mat = mats.find((x) => x.code === tagCode);
    if (!mat || !targets.length) return;
    const z = Date.now();
    const k = Math.max(1, (ctx.elements.find((e) => e.meta?.material)?.width ?? 220) / 220);
    const tags = targets.map((t, i) => makeElement("rect", t.x + t.width / 2 - 34 * k, t.y + t.height / 2 - 17 * k, {
      width: 68 * k, height: 34 * k, fill: mat.color, stroke: "#0f172a", text: mat.code, fontSize: Math.round(15 * k), z: z + i, meta: { materialTag: mat.code },
    }));
    ctx.api.add(tags);
    ctx.toast(`Tagged ${tags.length} with ${mat.code} ${mat.name}.`);
  };

  const schedule = () => {
    const sw = ctx.elements.filter((e) => e.meta?.material);
    const groups = new Set(sw.map((e) => e.groupId).filter(Boolean));
    const board = ctx.elements.filter((e) => sw.includes(e) || (e.groupId && groups.has(e.groupId))); // swatches and their captions
    const id = upsertTable(ctx, "finishes", finishesSchedule(ctx.elements), 760, boxOf(board), Math.max(1, (sw[0]?.width ?? 220) / 220));
    ctx.select([id]);
    ctx.toast("Finishes schedule updated.");
  };

  const field = (k: "name" | "finish" | "supplier", label: string) => (
    <input className="input py-1.5" placeholder={label} aria-label={label} value={m[k] ?? ""} onChange={(e) => setM({ ...m, [k]: e.target.value })} />
  );
  return (
    <PluginPanel icon={Palette} title="Material board" onClose={onClose}>
      <Section title="New swatch" hint="Start from the library or type your own, then add a color or a photo of the sample.">
        <div className="flex flex-wrap gap-1">
          {MATERIAL_LIBRARY.map((x) => (
            <button key={x.name} title={x.name} onClick={() => setM(x)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${m.name === x.name ? "border-slate-900" : "border-slate-200 hover:bg-slate-50"}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.color }} /> {x.name}
            </button>
          ))}
        </div>
        {field("name", "Material")}
        {field("finish", "Finish")}
        {field("supplier", "Supplier and product")}
        <div className="flex items-center gap-2">
          <input className="input py-1.5" type="number" min={0} step="any" placeholder="Cost per m²" aria-label="Cost per m²"
            value={m.cost ?? ""} onChange={(e) => setM({ ...m, cost: e.target.value ? Number(e.target.value) : undefined })} />
          <input type="color" className="h-9 w-10 shrink-0 cursor-pointer rounded border border-slate-200" value={m.color} aria-label="Color"
            onChange={(e) => setM({ ...m, color: e.target.value })} />
          <button className={`btn-outline h-9 shrink-0 px-2 ${photo ? "border-rose-400" : ""}`} title={photo ? `Photo: ${photo.name}` : "Use a photo of the sample"}
            onClick={() => fileRef.current?.click()}><ImagePlus size={15} /></button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        </div>
        {photo && <p className="truncate text-[11px] text-slate-500">Photo: {photo.name} <button className="underline" onClick={() => setPhoto(null)}>remove</button></p>}
        <button className="btn-primary w-full" disabled={busy || !m.name.trim()} onClick={addSwatch}>{busy ? "Uploading…" : "Add swatch"}</button>
      </Section>

      <Section title="Place on a plan" divided hint={mats.length ? (targets.length ? `${targets.length} item${targets.length > 1 ? "s" : ""} selected.` : "Select rooms, areas or parts of a render to tag.") : "Add a swatch first."}>
        <div className="flex gap-1">
          <select className="input py-1.5" value={tagCode} onChange={(e) => setTagCode(e.target.value)} disabled={!mats.length} aria-label="Material">
            <option value="">Material…</option>
            {mats.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
          </select>
          <button className="btn-primary px-3" disabled={!tagCode || !targets.length} onClick={tag} title="Tag the selection"><Tag size={15} /></button>
        </div>
      </Section>

      <Section title="Finishes schedule" divided hint={`${mats.length} material${mats.length === 1 ? "" : "s"} on this board.`}>
        <button className="btn-outline w-full" disabled={!mats.length} onClick={schedule}><RefreshCw size={15} /> Update finishes schedule</button>
      </Section>
    </PluginPanel>
  );
}
