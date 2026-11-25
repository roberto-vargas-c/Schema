/**
 * Tips for the drawing tools. A stroke keeps its tip (`PenElement.tip`); strokes drawn before tips
 * existed have none and draw as the pen (or, with their low opacity, as the highlighter).
 */
export type PenTip = "pen" | "pencil" | "fineliner" | "marker" | "highlighter";

export type PenTipDef = {
  id: PenTip;
  label: string;
  /** Widths offered in the palette, in board units. */
  widths: number[];
  defaultWidth: number;
  /** Opacity the stroke is saved with. */
  opacity: number;
  /** Curve smoothing for the drawn line (Konva tension). */
  tension: number;
  lineCap: "round" | "butt" | "square";
  /** Drawn with a graphite grain instead of solid ink. */
  textured?: boolean;
};

export const PEN_TIPS: PenTipDef[] = [
  { id: "pen", label: "Pen", widths: [1, 2, 3, 5, 8, 12, 18, 26], defaultWidth: 3, opacity: 1, tension: 0.4, lineCap: "round" },
  { id: "pencil", label: "Pencil", widths: [1, 1.5, 2, 3, 5, 8], defaultWidth: 2, opacity: 0.85, tension: 0.4, lineCap: "round", textured: true },
  { id: "fineliner", label: "Fine liner", widths: [0.5, 0.75, 1, 1.5, 2, 3], defaultWidth: 1, opacity: 1, tension: 0.15, lineCap: "round" },
  { id: "marker", label: "Marker", widths: [5, 8, 12, 18, 26], defaultWidth: 8, opacity: 0.8, tension: 0.3, lineCap: "butt" },
  { id: "highlighter", label: "Highlighter", widths: [10, 18, 28, 40], defaultWidth: 18, opacity: 0.35, tension: 0.4, lineCap: "round" },
];

export const TIP_BY_ID = Object.fromEntries(PEN_TIPS.map((t) => [t.id, t])) as Record<PenTip, PenTipDef>;

export function tipOf(tip: string | undefined): PenTipDef {
  return TIP_BY_ID[tip as PenTip] ?? TIP_BY_ID.pen;
}

/** Highlighter ink: black would hide what it marks, so it turns yellow. */
export function tipColor(tip: PenTip, color: string): string {
  return tip === "highlighter" && color.toLowerCase() === "#111827" ? "#facc15" : color;
}
