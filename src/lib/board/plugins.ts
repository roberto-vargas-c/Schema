// Shared logic of the architect plug-ins: room programs and adjacency in Keystone's CSV format, measured room areas,
// and the tables the plug-ins keep up to date. Kept free of React so it can be tested with node --test.
import type { BoardElement, ConnectorElement, MeasureElement, RoomBrief, WallElement } from "./types";
import { metersPerPxAt, polygonArea, type BoardScale } from "./arch";

/** "12,5" or "12.5" or "1 200" as a number; NaN when it isn't one. */
export function num(s: string | undefined): number {
  if (s == null) return NaN;
  const t = s.trim().replace(/\s|m²|m2/g, "");
  if (!t) return NaN;
  // 1.200,5 (German) → 1200.5; 1,200.5 (English) → 1200.5; 12,5 → 12.5
  const de = /,\d{1,2}$/.test(t) && !/\.\d+$/.test(t);
  return Number(de ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""));
}

/**
 * A room program from pasted text: one room a line, "Name; area" or "Name; count; area per room", separated by semicolons, tabs
 * or commas. Keystone's own program files (No.; Room; Count; Area each; Total) read too: lines without numbers are groups,
 * header lines are skipped.
 */
export function parseProgram(text: string): RoomBrief[] {
  const rooms: RoomBrief[] = [];
  let group: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
    let cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    // drop a leading numbering column ("1.2")
    if (cells.length > 1 && /^\d+(\.\d+)*\.?$/.test(cells[0])) cells = cells.slice(1);
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    // "Living 32" or "Living 32 m²": the area after a space
    const spaced = cells.length === 1 && cells[0].match(/^(.*\D)\s+(\d+(?:[.,]\d+)?)\s*(?:m²|m2)?$/);
    if (spaced) cells = [spaced[1].trim(), spaced[2]];
    const name = cells[0];
    if (!name) continue;
    const nums = cells.slice(1).map(num).filter((n) => !Number.isNaN(n));
    if (!nums.length) {
      // a group line, or a header ("Room; m²")
      if (cells.length <= 1 || cells.slice(1).every((c) => !c)) group = name;
      continue;
    }
    let count = 1, area = nums[0];
    if (nums.length >= 2) {
      // Name; count; m² per room (; total) — a count is a small whole number
      if (Number.isInteger(nums[0]) && nums[0] < 1000 && nums.length >= 2) { count = Math.max(1, nums[0]); area = nums[1]; }
    }
    if (!(area > 0)) continue;
    rooms.push({ name, area, ...(count > 1 && { count }), ...(group && { group }) });
  }
  return rooms;
}

const csvCell = (s: string | number) => {
  const t = String(s);
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const de = (n: number) => String(Math.round(n * 100) / 100);

/** The program as Keystone reads it (semicolons, one row per room type, groups as their own rows; "Area each" is the m² of one room). */
export function programCsv(rooms: RoomBrief[], title = "Room program"): string {
  const rows: (string | number)[][] = [[title, "", "", "", ""], ["No.", "Room", "Count", "Area each", "Total"]];
  const groups = Array.from(new Set(rooms.map((r) => r.group ?? "")));
  groups.forEach((g, gi) => {
    const list = rooms.filter((r) => (r.group ?? "") === g);
    const prefix = g ? `${gi + 1}.` : "";
    if (g) rows.push([gi + 1, g, "", "", ""]);
    list.forEach((r, i) => rows.push([`${prefix}${i + 1}`, r.name, r.count ?? 1, de(r.area), de(r.area * (r.count ?? 1))]));
  });
  return rows.map((r) => r.map(csvCell).join(";")).join("\n") + "\n";
}

export type Relation = { a: string; b: string; w: 3 | 1 | -1 };
const SIGN: Record<number, string> = { 3: "++", 1: "+", [-1]: "-" };

/** The adjacency matrix as Keystone reads it: ++ must be next to, + nice to be near, - keep apart. */
export function adjacencyCsv(rooms: RoomBrief[], relations: Relation[]): string {
  const names = Array.from(new Set(rooms.map((r) => r.name)));
  const rows = [["Adjacency", ...names]];
  for (const a of names) {
    rows.push([a, ...names.map((b) => {
      if (a === b) return "";
      const r = relations.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
      // write each pair once, in the upper triangle
      return r && names.indexOf(a) < names.indexOf(b) ? SIGN[r.w] : "";
    })]);
  }
  return rows.map((r) => r.map(csvCell).join(";")).join("\n")
    + "\n\n\"Values: ++ = must be next to, + = nice to be near, - = keep apart. Empty = no relation.\"\n";
}

/** A bubble's room; its name follows the first line of its label when someone renames it on the board. */
export function roomOf(b: BoardElement): RoomBrief {
  const r = b.meta!.room!;
  const first = (b.text ?? "").split("\n")[0].trim();
  return first && first !== r.name ? { ...r, name: first } : r;
}

/** The rooms and relations of the bubble diagrams on a board. */
export function bubbleDiagram(elements: BoardElement[]) {
  const bubbles = elements.filter((e) => e.meta?.room);
  const byId = new Map(bubbles.map((b) => [b.id, b]));
  const relations: Relation[] = [];
  for (const e of elements) {
    if (e.type !== "connector" || !e.meta?.adjacency) continue;
    const c = e as ConnectorElement;
    const a = c.from.id ? byId.get(c.from.id) : undefined, b = c.to.id ? byId.get(c.to.id) : undefined;
    if (a && b) relations.push({ a: roomOf(a).name, b: roomOf(b).name, w: e.meta.adjacency });
  }
  return { rooms: bubbles.map(roomOf), bubbles, relations };
}

/** Diameter in board units of a circle of `m2` square meters, at `pxPerM`. */
export const bubbleDiameter = (m2: number, pxPerM: number) => 2 * Math.sqrt(Math.max(0.5, m2) / Math.PI) * pxPerM;

/** Elements that enclose a room: measured areas, closed walls and room bubbles. */
export const isRoomShape = (e: BoardElement) =>
  e.type === "area" || (e.type === "wall" && !!(e as WallElement).closed && Array.isArray((e as WallElement).points)) || !!e.meta?.room;

/**
 * The floor area of a room shape in m² (null when the board has no scale there). A closed wall counts to its centerline.
 * A bubble's area is its brief.
 */
export function roomArea(e: BoardElement, elements: BoardElement[], board: BoardScale): number | null {
  if (e.meta?.room) return e.meta.room.area * (e.meta.room.count ?? 1);
  const pts = (e as MeasureElement).points;
  if (!pts || pts.length < 6) return null;
  const k = metersPerPxAt(elements, { x: e.x + e.width / 2, y: e.y + e.height / 2 }, board);
  return k ? polygonArea(pts) * k * k : null;
}

/** The brief area of a room name (all bubbles and their counts), for comparing measured rooms with the program. */
export function briefFor(name: string, rooms: RoomBrief[]): number | null {
  const n = name.trim().toLowerCase();
  const list = rooms.filter((r) => r.name.trim().toLowerCase() === n);
  return list.length ? list.reduce((s, r) => s + r.area, 0) : null;
}

/** Hands the browser a text file to save. */
export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
