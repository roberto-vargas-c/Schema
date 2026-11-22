// Board element model. Elements live in a Y.Map<BoardElement> named "elements" inside the board's Y.Doc.

export type ElementType =
  | "sticky"
  | "rect"
  | "ellipse"
  | "diamond"
  | "text"
  | "connector"
  | "pen"
  | "image"
  | "frame"
  // Architecture tools
  | "dimension" // measured length between two points
  | "area" // measured polygon
  | "wall" // rotated rect drawn from A to B
  | "cloud" // revision cloud (redline)
  | "symbol" // plan symbol from the library (door, window, furniture…)
  // Content blocks
  | "card" // task card with assignee, due date and status
  | "table"
  | "topic" // mind map node
  | "shape" // extra diagram shapes (triangle, cylinder, …)
  | "embed" // link / video / Figma etc.
  | "video" // uploaded video file
  | "sticker" // sticker art or a big emoji
  | "doc"; // rich-text document; its content is the Y.XmlFragment docFragment(id)

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number; // stacking order
  fill: string;
  stroke: string;
  text?: string;
  fontSize?: number;
  locked?: boolean;
  /** 0–1; fully opaque when missing. */
  opacity?: number;
  /** Font id from FONTS; the default sans-serif when missing. */
  font?: string;
  /** Text alignment; each type has its own default. */
  align?: "left" | "center" | "right";
  /** Who created it (shown on sticky notes when "Show authors" is on). */
  author?: { id: string; name: string; color?: string };
  /** Items with the same group id are selected and moved together. */
  groupId?: string;
  /** Set on elements created while private mode is on; others see them hidden until it ends. */
  privateOwner?: string;
}

export interface ConnectorElement extends BaseElement {
  type: "connector";
  // Endpoints: either attached to another element or a free point (world coords).
  from: { id?: string; x: number; y: number };
  to: { id?: string; x: number; y: number };
  arrowEnd: boolean;
  arrowStart: boolean;
  /** Line shape; straight when missing. */
  style?: ConnectorStyle;
  /** Line pattern; solid when missing. */
  pattern?: "solid" | "dashed" | "dotted";
}

export type ConnectorStyle = "straight" | "curved" | "elbow";

export interface PenElement extends BaseElement {
  type: "pen";
  points: number[]; // relative to x,y
  strokeWidth: number;
}

/** Real-world scale of a plan: `metersPerPx` meters per world pixel when the element is `refWidth` wide. */
export type PlanScale = { metersPerPx: number; refWidth: number };

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  /** Set for imported plans (PDF pages or images). */
  plan?: { name: string; page?: number; /** width in PDF points (1/72 in) when imported from PDF */ paperWidthPt?: number;
    /** The original PDF, kept so editors can download it. */ source?: string };
  scale?: PlanScale;
  /** Mirrored horizontally / vertically. */
  /** Animated GIF: played on the board. */
  animated?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  /** Tracing paper overlay: the picture's dark lines drawn in this color on a see-through ground. */
  tint?: string;
  /** Visible part of the picture, as fractions (0–1) of its natural size. */
  crop?: { x: number; y: number; width: number; height: number };
}

export interface StickerElement extends BaseElement {
  type: "sticker";
  /** Id from STICKER_PACKS, or an emoji character. */
  sticker?: string;
  emoji?: string;
}

/** A document on the board. `text` holds a plain-text preview, kept up to date by the editor. */
export interface DocElement extends BaseElement {
  type: "doc";
  title: string;
}
/** Name of the Yjs fragment that holds a document's content. */
export const docFragment = (id: string) => `doc:${id}`;

export interface VideoElement extends BaseElement {
  type: "video";
  src: string;
  name?: string;
  mimeType?: string;
}

/** Dimension (2 points) or area (polygon) measurement; points are relative to x,y like pen strokes. */
export interface MeasureElement extends BaseElement {
  type: "dimension" | "area";
  points: number[];
}

export interface SymbolElement extends BaseElement {
  type: "symbol";
  symbol: string;
}

export type CardStatus = "todo" | "doing" | "done" | "blocked";
export interface CardElement extends BaseElement {
  type: "card";
  assignee?: { id: string; name: string; color: string } | null;
  due?: string | null; // yyyy-mm-dd
  status: CardStatus;
}

export interface TableElement extends BaseElement {
  type: "table";
  cells: string[][]; // [row][col]
  header: boolean;
}

export interface TopicElement extends BaseElement {
  type: "topic";
  /** Root topic of the mind map this node belongs to (its own id for a root). */
  root: string;
  level: number;
}

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape: string;
}

export interface EmbedElement extends BaseElement {
  type: "embed";
  url: string;
  title?: string;
  site?: string;
  description?: string;
}

export type BoardElement =
  | BaseElement | ConnectorElement | PenElement | ImageElement | MeasureElement | SymbolElement
  | CardElement | TableElement | TopicElement | ShapeElement | EmbedElement | VideoElement | StickerElement | DocElement | WallElement;

/** Wall drawn as a polyline (older walls are plain rotated rectangles without points). */
export interface WallElement extends BaseElement {
  type: "wall";
  points?: number[];
  /** Wall thickness in board units. */
  thickness?: number;
  closed?: boolean;
}

export function hasPoints(el: BoardElement): el is PenElement | MeasureElement {
  return el.type === "pen" || el.type === "dimension" || el.type === "area" || (el.type === "wall" && Array.isArray((el as WallElement).points));
}

export const STICKY_COLORS = ["#fde68a", "#fbcfe8", "#bfdbfe", "#bbf7d0", "#ddd6fe", "#fed7aa", "#e5e7eb"];
export const SHAPE_COLORS = ["#ffffff", "#0f766e", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#111827"];

let counter = 0;
export function newId() {
  counter = (counter + 1) % 1e6;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${counter.toString(36)}`;
}

export function makeElement(type: ElementType, x: number, y: number, extra: Partial<BoardElement> = {}): BoardElement {
  const base: BaseElement = {
    id: newId(),
    type,
    x,
    y,
    width: 160,
    height: 160,
    rotation: 0,
    z: Date.now(),
    fill: "#ffffff",
    stroke: "#1f2937",
  };
  switch (type) {
    case "sticky":
      return { ...base, width: 180, height: 180, fill: STICKY_COLORS[0], stroke: "transparent", text: "", fontSize: 18, ...extra } as BaseElement;
    case "rect":
    case "ellipse":
    case "diamond":
      return { ...base, width: 180, height: 120, fill: "#ffffff", stroke: "#1f2937", text: "", fontSize: 16, ...extra } as BaseElement;
    case "text":
      return { ...base, width: 240, height: 40, fill: "transparent", stroke: "#111827", text: "Text", fontSize: 24, ...extra } as BaseElement;
    case "frame":
      return { ...base, width: 800, height: 520, fill: "#ffffff", stroke: "#cbd5e1", text: "Frame", z: 0, ...extra } as BaseElement;
    case "card":
      return { ...base, width: 260, height: 120, fill: "#ffffff", stroke: "#2563eb", text: "New task", fontSize: 16, status: "todo", ...extra } as CardElement;
    case "table":
      return {
        ...base, width: 480, height: 160, fill: "#ffffff", stroke: "#94a3b8", fontSize: 14, header: true,
        cells: [["Room", "Area", "Notes"], ["", "", ""], ["", "", ""], ["", "", ""]], ...extra,
      } as TableElement;
    case "topic":
      return { ...base, width: 200, height: 56, fill: "#0f8573", stroke: "#0f8573", text: "Central idea", fontSize: 18, root: base.id, level: 0, ...extra } as TopicElement;
    case "shape":
      return { ...base, width: 160, height: 120, fill: "#ffffff", stroke: "#1f2937", text: "", fontSize: 16, shape: "triangle", ...extra } as ShapeElement;
    case "doc":
      return { ...base, width: 260, height: 320, fill: "#ffffff", stroke: "#cbd5e1", title: "Untitled document", text: "", ...extra } as DocElement;
    case "embed":
      return { ...base, width: 360, height: 120, fill: "#ffffff", stroke: "#cbd5e1", url: "", ...extra } as EmbedElement;
    default:
      return { ...base, ...extra } as BaseElement;
  }
}

export const FONTS: { id: string; name: string; family: string }[] = [
  { id: "sans", name: "Sans", family: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" },
  { id: "serif", name: "Serif", family: "Georgia, 'Times New Roman', ui-serif, serif" },
  { id: "mono", name: "Mono", family: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  { id: "rounded", name: "Rounded", family: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Nunito', 'Varela Round', sans-serif" },
  { id: "hand", name: "Handwriting", family: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Chalkboard SE', cursive" },
  { id: "condensed", name: "Condensed", family: "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', sans-serif-condensed, sans-serif" },
];
export const fontFamily = (id?: string) => (FONTS.find((f) => f.id === id) ?? FONTS[0]).family;
