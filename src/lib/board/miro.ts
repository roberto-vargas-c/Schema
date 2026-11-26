// Turns Miro board items (REST API v2) into Schema elements, and Miro clipboard text into sticky notes.
import { makeElement, type BoardElement, type ConnectorElement, type ImageElement, type ShapeElement } from "./types";

/** A Miro board item as the REST API v2 returns it (only the fields we read). */
export type MiroItem = {
  id: string;
  type: string;
  data?: Record<string, unknown> & { content?: string; title?: string; shape?: string; imageUrl?: string; url?: string; description?: string };
  style?: Record<string, string | undefined>;
  position?: { x: number; y: number; origin?: string; relativeTo?: string };
  geometry?: { width?: number; height?: number; rotation?: number };
  parent?: { id: string } | null;
};

export type MiroConnector = {
  id: string;
  shape?: "straight" | "elbowed" | "curved";
  startItem?: { id: string };
  endItem?: { id: string };
  style?: { strokeColor?: string; strokeWidth?: string; strokeStyle?: string; startStrokeCap?: string; endStrokeCap?: string };
  captions?: { content?: string }[];
};

/** Board id from a Miro link such as https://miro.com/app/board/uXjVN1234=/?share_link_id=… */
export function miroBoardId(link: string): string | null {
  const m = link.trim().match(/miro\.com\/app\/board\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  // A bare board id (they end in "=").
  return /^[A-Za-z0-9_-]{6,}=?$/.test(link.trim()) ? link.trim() : null;
}

const STICKY_FILL: Record<string, string> = {
  gray: "#f5f6f8", light_yellow: "#fff9b1", yellow: "#f5d128", orange: "#ff9d48", light_green: "#d5f692", green: "#c9df56",
  dark_green: "#93d275", cyan: "#67c6c0", light_pink: "#ffcee0", pink: "#ea94bb", violet: "#c6a2d2", red: "#f0939d",
  light_blue: "#a6ccf5", blue: "#6cd8fa", dark_blue: "#9ea9ff", black: "#1a1a1a", white: "#ffffff",
};

/** Miro shape name -> our element type (and diagram shape id for "shape" elements). */
const SHAPES: Record<string, ["rect" | "ellipse" | "diamond"] | ["shape", string]> = {
  rectangle: ["rect"], round_rectangle: ["rect"], square: ["rect"], flow_chart_process: ["rect"], flow_chart_predefined_process: ["rect"],
  circle: ["ellipse"], ellipse: ["ellipse"], cloud: ["ellipse"], flow_chart_connector: ["ellipse"], flow_chart_terminator: ["rect"],
  rhombus: ["diamond"], flow_chart_decision: ["diamond"],
  triangle: ["shape", "triangle"], hexagon: ["shape", "hexagon"], flow_chart_preparation: ["shape", "hexagon"], pentagon: ["shape", "pentagon"],
  parallelogram: ["shape", "parallelogram"], flow_chart_input_output: ["shape", "parallelogram"], trapezoid: ["shape", "trapezoid"],
  flow_chart_manual_operation: ["shape", "trapezoid"], can: ["shape", "cylinder"], flow_chart_magnetic_disk: ["shape", "cylinder"],
  star: ["shape", "star"], right_arrow: ["shape", "arrow"], left_right_arrow: ["shape", "arrow"], cross: ["shape", "plus"],
  wedge_round_rectangle_callout: ["shape", "callout"], flow_chart_document: ["shape", "document"], flow_chart_multidocuments: ["shape", "document"],
  pentagon_arrow: ["shape", "chevron"], chevron: ["shape", "chevron"],
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Miro stores text as simple HTML; keep the words and line breaks. */
export function htmlToText(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const color = (c: string | undefined, fallback: string) =>
  !c ? fallback : c === "transparent" ? "transparent" : /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback;
const num = (v: string | number | undefined, fallback: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fallback; };

export type MiroImport = {
  elements: BoardElement[];
  /** Image elements whose src is still the Miro image API link; the server swaps in a stored copy. */
  images: { elementId: string; miroUrl: string }[];
  skipped: Record<string, number>;
  /** Items Miro doesn't share the content of, kept as labelled boxes where they were. */
  placeholders: Record<string, number>;
};

/** Items whose content Miro's API doesn't give apps: kept as a labelled box so the layout survives. */
const PLACEHOLDER_LABEL: Record<string, string> = {
  preview: "Link preview", table: "Table", table_text: "Table", data_table_format: "Table", doc_format: "Doc",
  kanban: "Kanban", mindmap_node: "Mind map", unsupported: "Miro item", usm: "Story map", code: "Code block",
};

/** Text a Miro item carries in any of the fields its different types use. */
function anyText(d: Record<string, unknown> | undefined): string {
  if (!d) return "";
  for (const k of ["content", "text", "title", "plainText", "description"]) {
    const v = d[k];
    if (typeof v === "string" && v.trim()) return htmlToText(v);
    if (v && typeof v === "object" && typeof (v as { content?: unknown }).content === "string") return htmlToText((v as { content: string }).content);
  }
  return "";
}

/** A data table's cells, when Miro gives them (rows of cells, or columns plus rows). */
function tableCells(d: Record<string, unknown> | undefined): string[][] | null {
  if (!d) return null;
  const cellText = (c: unknown): string =>
    typeof c === "string" ? htmlToText(c) : typeof c === "number" || typeof c === "boolean" ? String(c)
      : c && typeof c === "object" ? anyText(c as Record<string, unknown>) || String((c as { value?: unknown }).value ?? "") : "";
  const cols = Array.isArray(d.columns) ? (d.columns as unknown[]).map(cellText) : null;
  const rows = Array.isArray(d.rows) ? (d.rows as unknown[]) : null;
  if (!rows?.length && !cols?.length) return null;
  const body = (rows ?? []).slice(0, 200).map((r) => {
    if (Array.isArray(r)) return r.map(cellText);
    const o = (r ?? {}) as Record<string, unknown>;
    const cells = Array.isArray(o.cells) ? o.cells : Array.isArray(o.values) ? o.values : null;
    return cells ? (cells as unknown[]).map(cellText) : Object.values(o).map(cellText);
  });
  const all = cols?.length ? [cols, ...body] : body;
  const width = Math.min(30, Math.max(1, ...all.map((r) => r.length)));
  return all.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

/**
 * Maps Miro items and connectors to elements with the content's top-left corner at (0, 0).
 * Miro positions are item centers; children of a frame are relative to the frame's top-left corner.
 */
export function mapMiroBoard(items: MiroItem[], connectors: MiroConnector[], more: { refs?: MiroItem[] } = {}): MiroImport {
  // `refs`: items fetched one by one because a connector ends on them, only used for where they are.
  const byId = new Map([...(more.refs ?? []), ...items].map((i) => [i.id, i]));
  const centers = new Map<string, { x: number; y: number }>();
  const centerOf = (it: MiroItem, depth = 0): { x: number; y: number } => {
    const known = centers.get(it.id);
    if (known) return known;
    let x = it.position?.x ?? 0, y = it.position?.y ?? 0;
    const parent = it.parent?.id ? byId.get(it.parent.id) : undefined;
    if (parent && depth < 10 && it.position?.relativeTo !== "canvas_center") {
      const pc = centerOf(parent, depth + 1);
      x += pc.x - (parent.geometry?.width ?? 0) / 2;
      y += pc.y - (parent.geometry?.height ?? 0) / 2;
    }
    const c = { x, y };
    centers.set(it.id, c);
    return c;
  };

  const elements: BoardElement[] = [];
  const images: MiroImport["images"] = [];
  const skipped: Record<string, number> = {};
  const placeholders: Record<string, number> = {};
  const idMap = new Map<string, string>();
  // Frames first so they sit underneath their contents.
  const ordered = [...items].sort((a, b) => Number(b.type === "frame") - Number(a.type === "frame"));
  let z = 1;

  // A data table Miro gives the cells of comes over whole, so its cell items are already in it.
  const tables = new Set(items.filter((i) => (i.type === "table" || i.type === "data_table_format") && tableCells(i.data)).map((i) => i.id));

  for (const it of ordered) {
    if (it.parent?.id && tables.has(it.parent.id)) continue;
    const w = it.geometry?.width ?? 0, h = it.geometry?.height ?? 0;
    const c = centerOf(it);
    const at = (dw: number, dh: number) => ({ x: c.x - (w || dw) / 2, y: c.y - (h || dh) / 2, width: w || dw, height: h || dh });
    const s = it.style ?? {};
    const text = htmlToText(it.data?.content);
    let el: BoardElement | null = null;

    switch (it.type) {
      case "sticky_note": {
        const g = at(200, 230);
        el = makeElement("sticky", g.x, g.y, {
          ...g, text, fill: STICKY_FILL[s.fillColor ?? ""] ?? STICKY_FILL.light_yellow, fontSize: Math.min(36, Math.max(12, g.width / 11)),
          align: s.textAlign === "left" || s.textAlign === "right" ? s.textAlign : undefined,
        });
        break;
      }
      case "shape": {
        const g = at(180, 120);
        const [type, shape] = SHAPES[it.data?.shape ?? ""] ?? ["rect"];
        const opacity = num(s.fillOpacity, 1);
        el = makeElement(type, g.x, g.y, {
          ...g, text, fontSize: num(s.fontSize, 16),
          fill: color(s.fillColor, opacity < 0.05 ? "transparent" : "#ffffff"),
          stroke: num(s.borderOpacity, 1) < 0.05 || s.borderWidth === "0" ? "transparent" : color(s.borderColor, "#1a1a1a"),
          align: s.textAlign === "left" || s.textAlign === "right" ? s.textAlign : undefined,
        });
        if (type === "shape") (el as ShapeElement).shape = shape!;
        break;
      }
      case "text": {
        const g = at(240, 40);
        el = makeElement("text", g.x, g.y, {
          ...g, text: text || " ", fontSize: num(s.fontSize, 18), stroke: color(s.color, "#111827"),
          fill: color(s.fillColor, "transparent"),
          align: s.textAlign === "center" || s.textAlign === "right" ? s.textAlign : "left",
        });
        break;
      }
      case "frame": {
        const g = at(800, 520);
        el = makeElement("frame", g.x, g.y, { ...g, text: htmlToText(it.data?.title) || "Frame", fill: color(s.fillColor, "#ffffff"), z: 0 });
        break;
      }
      case "card":
      case "app_card": {
        const g = at(320, 120);
        const desc = htmlToText(it.data?.description);
        el = makeElement("card", g.x, g.y, { ...g, text: [htmlToText(it.data?.title), desc].filter(Boolean).join("\n") || "Card" });
        break;
      }
      case "image": {
        const g = at(400, 300);
        const url = typeof it.data?.imageUrl === "string" ? it.data.imageUrl : "";
        if (!url) break;
        el = makeElement("image", g.x, g.y, { ...g, fill: "transparent", stroke: "transparent" });
        (el as ImageElement).src = "";
        images.push({ elementId: el.id, miroUrl: url });
        break;
      }
      case "embed":
      case "document": {
        const d = it.data ?? {};
        const html = typeof d.html === "string" ? d.html : "";
        const url = [d.url, d.documentUrl, html.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i)?.[1]]
          .find((v): v is string => typeof v === "string" && /^https?:\/\//i.test(v.replace(/&amp;/g, "&")))?.replace(/&amp;/g, "&") ?? "";
        const preview = typeof d.previewUrl === "string" ? d.previewUrl : "";
        if (url) {
          const g = at(360, 120);
          el = makeElement("embed", g.x, g.y, { ...g, width: Math.max(g.width, 240), height: Math.max(g.height, 100) });
          Object.assign(el, { url, title: htmlToText(d.title as string | undefined) || undefined, site: typeof d.providerName === "string" ? d.providerName : undefined });
        } else if (preview) {
          // No link, but Miro keeps a picture of it.
          const g = at(400, 300);
          el = makeElement("image", g.x, g.y, { ...g, fill: "transparent", stroke: "transparent" });
          (el as ImageElement).src = "";
          images.push({ elementId: el.id, miroUrl: preview });
        }
        break;
      }
      case "data_table_format":
      case "table": {
        const cells = tableCells(it.data);
        if (!cells) break;
        const g = at(480, 160);
        el = makeElement("table", g.x, g.y, { ...g, cells, header: true });
        break;
      }
      case "mindmap_node": {
        const t = anyText(it.data) || htmlToText((it.data?.nodeView as { data?: { content?: string } } | undefined)?.data?.content);
        if (!t) break;
        const g = at(160, 50);
        el = makeElement("text", g.x, g.y, { ...g, text: t, fontSize: 16, stroke: "#111827", fill: "transparent", align: "center" });
        break;
      }
    }
    if (!el && it.type !== "paint" && it.type !== "connector") {
      // Text in a type we don't model (table text, say) still comes over as text.
      const t = anyText(it.data);
      if (t) {
        const g = at(240, 40);
        el = makeElement("text", g.x, g.y, { ...g, text: t, fontSize: num(s.fontSize, 16), stroke: color(s.color, "#111827"), fill: "transparent", align: "left" });
      } else if (w > 0 && h > 0 && !(it.parent?.id && byId.get(it.parent.id)?.type !== "frame")) {
        // (Parts of a bigger item, like a table's cells, are covered by that item's box.)
        // Nothing to show: a labelled box keeps the layout, so the person can see what to bring over by hand.
        const label = PLACEHOLDER_LABEL[it.type] ?? "Miro item";
        el = makeElement("rect", c.x - w / 2, c.y - h / 2, {
          width: w, height: h, text: `${label} (Miro doesn't share this with apps)`, fontSize: Math.max(12, Math.min(28, w / 16)),
          fill: "#f8fafc", stroke: "#94a3b8",
        });
        placeholders[it.type] = (placeholders[it.type] ?? 0) + 1;
      }
    }
    if (!el) { skipped[it.type] = (skipped[it.type] ?? 0) + 1; continue; }
    if (it.geometry?.rotation) el.rotation = it.geometry.rotation;
    if (el.type !== "frame") el.z = z++;
    idMap.set(it.id, el.id);
    elements.push(el);
  }

  for (const cn of connectors) {
    // An end on an item we couldn't bring over (a drawing, say) stays where that item was, unattached.
    const end = (ref: { id: string } | undefined): { id?: string; x: number; y: number } | null => {
      const id = ref?.id ? idMap.get(ref.id) : undefined;
      if (id) { const e = elements.find((x) => x.id === id)!; return { id, x: e.x + e.width / 2, y: e.y + e.height / 2 }; }
      const raw = ref?.id ? byId.get(ref.id) : undefined;
      return raw ? centerOf(raw) : null;
    };
    const fromEnd = end(cn.startItem), toEnd = end(cn.endItem);
    if (!fromEnd || !toEnd) { skipped.connector = (skipped.connector ?? 0) + 1; continue; }
    const s = cn.style ?? {};
    const el = makeElement("connector", 0, 0) as ConnectorElement;
    Object.assign(el, {
      width: 0, height: 0, z: z++,
      stroke: color(s.strokeColor, "#1a1a1a"),
      from: fromEnd,
      to: toEnd,
      arrowEnd: (s.endStrokeCap ?? "stealth") !== "none",
      arrowStart: !!s.startStrokeCap && s.startStrokeCap !== "none",
      style: cn.shape === "curved" ? "curved" : cn.shape === "elbowed" ? "elbow" : "straight",
      pattern: s.strokeStyle === "dashed" ? "dashed" : s.strokeStyle === "dotted" ? "dotted" : "solid",
      text: cn.captions?.map((x) => htmlToText(x.content)).filter(Boolean).join(" ") || undefined,
    });
    elements.push(el);
  }

  // Move everything so the content's top-left corner is at (0, 0).
  const placed = elements.filter((e) => e.type !== "connector");
  if (placed.length) {
    const minX = Math.min(...placed.map((e) => e.x)), minY = Math.min(...placed.map((e) => e.y));
    for (const e of elements) {
      if (e.type === "connector") {
        const c = e as ConnectorElement;
        c.from = { ...c.from, x: c.from.x - minX, y: c.from.y - minY };
        c.to = { ...c.to, x: c.to.x - minX, y: c.to.y - minY };
      } else { e.x -= minX; e.y -= minY; }
    }
  }
  return { elements, images, skipped, placeholders };
}

/**
 * Splits pasted text into sticky-note texts. Copying sticky notes in Miro puts each note's text on its own
 * line (or paragraph) in the plain-text clipboard; HTML, when there is any, keeps notes with several lines together.
 */
export function pastedNotes(plain: string, html?: string): string[] {
  if (html) {
    // Miro (and most apps) put each item in its own block element.
    // Innermost blocks first (paragraphs, list items, cells), then divs without nested blocks.
    for (const re of [/<(p|li|h[1-6]|td)\b[^>]*>([\s\S]*?)<\/\1>/gi, /<(div)\b[^>]*>((?:(?!<div\b)[\s\S])*?)<\/div>/gi]) {
      const blocks = Array.from(html.matchAll(re)).map((m) => htmlToText(m[2])).filter((t) => t.trim());
      if (blocks.length > 1) return blocks.slice(0, 200);
    }
  }
  const text = plain.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const parts = text.includes("\n\n") ? text.split(/\n\s*\n/) : text.split("\n");
  return parts.map((t) => t.trim()).filter(Boolean).slice(0, 200);
}

/** Something copied in Miro that carries a file (picture, PDF, video, other document). */
export type MiroClipFile = {
  /** Miro's id for the item on its board (used with the REST API). */
  itemId: string;
  kind: string;
  name?: string;
  /** Size on the Miro board, when known. */
  width?: number;
  height?: number;
};

/** What Miro's own clipboard payload says about a copy. */
export type MiroClip = { boardId: string | null; files: MiroClipFile[]; widgetTypes: string[] };

/** Widgets that hold only text or drawing; everything else may carry a file. */
const MIRO_TEXT_WIDGETS = new Set(["sticker", "shape", "text", "line", "paint", "frame", "grid_text", "data_table_widget", "card", "mindmap_node", "kanban", "comment"]);

/**
 * Reads the payload Miro puts in the copied HTML: `data-meta="<--(miro-data-v1)BASE64(/miro-data-v1)-->"`.
 * The base64 bytes are the payload's UTF-8 JSON with every byte shifted by 59.
 */
export function decodeMiroClipboard(html: string | undefined): MiroClip | null {
  const m = html?.match(/\(miro-data-v1\)([A-Za-z0-9+/=\s]+?)\(\/miro-data-v1\)/);
  if (!m) return null;
  let doc: { boardId?: string; data?: { objects?: unknown[] } };
  try {
    const bin = atob(m[1].replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = (bin.charCodeAt(i) - 59 + 256) & 255;
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const files: MiroClipFile[] = [];
  const widgetTypes: string[] = [];
  for (const raw of doc.data?.objects ?? []) {
    const o = raw as { initialId?: string | number; widgetData?: { type?: string; json?: unknown } };
    const type = o.widgetData?.type;
    if (!type) continue;
    widgetTypes.push(type);
    if (MIRO_TEXT_WIDGETS.has(type) || o.initialId == null) continue;
    let j: Record<string, unknown> = {};
    try { j = (typeof o.widgetData!.json === "string" ? JSON.parse(o.widgetData!.json) : o.widgetData!.json) ?? {}; } catch { /* keep the id */ }
    const res = (j.resource ?? {}) as Record<string, unknown>;
    const size = (j.size ?? {}) as { width?: number; height?: number };
    const scale = Number((j.scale as { scale?: number } | undefined)?.scale) || 1;
    const name = [res.name, j.title, j.name, res.title].find((v): v is string => typeof v === "string" && !!v.trim());
    files.push({
      itemId: String(o.initialId),
      kind: type,
      name: name ? htmlToText(name) : undefined,
      width: Number(size.width) ? Number(size.width) * scale : undefined,
      height: Number(size.height) ? Number(size.height) * scale : undefined,
    });
  }
  return { boardId: typeof doc.boardId === "string" && doc.boardId ? doc.boardId : null, files, widgetTypes };
}

/** Picture sources in copied HTML (from browsers, docs, Miro's fallback HTML), skipping tracking pixels. */
export function htmlImageSources(html: string | undefined): string[] {
  if (!html) return [];
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)) {
    const tag = m[0];
    const src = (m[1] ?? m[2] ?? m[3] ?? "").replace(/&amp;/g, "&").trim();
    if (!/^(https?:|data:image\/)/i.test(src)) continue;
    if (/\b(width|height)\s*=\s*["']?1["'\s>]/i.test(tag)) continue;
    if (!out.includes(src)) out.push(src);
  }
  return out.slice(0, 50);
}
