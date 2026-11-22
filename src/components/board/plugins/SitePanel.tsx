"use client";

import { useState } from "react";
import { Loader2, MapPinned, Search, X } from "lucide-react";
import type { BoardElement, ImageElement, SymbolElement, TableElement } from "@/lib/board/types";
import { makeElement } from "@/lib/board/types";
import { renderSiteMap, searchPlaces, type Place } from "@/lib/board/siteMap";
import { dayFacts, formatHours, sunPathSvg, svgToPng } from "@/lib/board/sun";

const WIDTHS = [250, 500, 1000, 2000];
const MAP = 1000; // board units: the map is MAP × MAP
const SUN = 680;

const ns = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;
const compass = (az: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(az / 45) % 8];

/** The rows of the "Sun through the year" table. */
export function sunTable(lat: number, lon: number, year: number): string[][] {
  const days = [
    { label: "21 March", month: 3, day: 21 }, { label: "21 June", month: 6, day: 21 },
    { label: "23 September", month: 9, day: 23 }, { label: "21 December", month: 12, day: 21 },
  ];
  return [["Day", "Daylight", "Sun at noon", "Sunrise · sunset"], ...days.map((d) => {
    const f = dayFacts(year, d.month, d.day, lat, lon);
    const rise = f.riseAz == null || f.setAz == null ? (f.polar === "day" ? "Sun up all day" : "Sun below the horizon")
      : `${Math.round(f.riseAz)}° ${compass(f.riseAz)} · ${Math.round(f.setAz)}° ${compass(f.setAz)}`;
    return [d.label, formatHours(f.dayLength), `${Math.max(0, f.noonAlt).toFixed(1)}° high`, rise];
  })];
}

/**
 * Site analysis plug-in: find an address (or type "lat, lon"), then one click lays a frame on the board with a north-up site map
 * at its real scale (measure on it straight away), a north arrow, the sun path diagram for the latitude and a table of the sun's
 * angles on the solstices and equinoxes.
 */
export function SitePanel({ upload, center, onAdd, onClose }: {
  upload: (blob: Blob, name: string) => Promise<string>; center: () => { x: number; y: number };
  onAdd: (els: BoardElement[], focus: BoardElement) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [width, setWidth] = useState(500);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setBusy("search"); setError(null); setResults(null);
    try {
      const r = await searchPlaces(query);
      if (r.length === 1) { setPlace(r[0]); setResults(null); } else setResults(r);
      if (!r.length) setError("Nothing found. Try a fuller address, or type the coordinates as \"45.4642, 9.19\"");
    } catch (e) { setError(e instanceof Error ? e.message : "The place search didn't answer"); } finally { setBusy(null); }
  };

  const build = async () => {
    if (!place) return;
    setError(null);
    try {
      setBusy("Loading the map…");
      const map = await renderSiteMap(place, width);
      const mapUrl = await upload(map.blob, "site-map.png");
      setBusy("Drawing the sun path…");
      const year = new Date().getFullYear();
      const sunUrl = await upload(await svgToPng(sunPathSvg(place.lat, place.lon, year), 1200), "sun-path.png");
      setBusy("Placing it on the board…");

      const c = center();
      const W = 40 + MAP + 40 + SUN + 40, H = 70 + MAP + 70;
      const x0 = c.x - W / 2, y0 = c.y - H / 2, z = Date.now();
      const short = place.name.split(",").slice(0, 2).join(",").trim();
      const frame = makeElement("frame", x0, y0, { width: W, height: H, text: `Site analysis · ${short}` });
      const mapEl = makeElement("image", x0 + 40, y0 + 60, {
        width: MAP, height: MAP, fill: "transparent", stroke: "transparent", locked: true, z: z + 1,
      }) as ImageElement;
      mapEl.src = mapUrl;
      mapEl.plan = { name: `Site map · ${short}` };
      mapEl.scale = { metersPerPx: width / MAP, refWidth: MAP };
      const north = Object.assign(makeElement("symbol", x0 + 40 + MAP - 84, y0 + 60 + 56, {
        width: 48, height: 80, fill: "#ffffff", stroke: "#111827", z: z + 2,
      }), { symbol: "north-outline" }) as SymbolElement;
      const text = (x: number, y: number, w: number, t: string, fontSize = 16, extra: Partial<BoardElement> = {}) =>
        makeElement("text", x, y, { width: w, height: fontSize * 1.6, text: t, fontSize, z: z + 3, ...extra });
      const northN = text(x0 + 40 + MAP - 100, y0 + 60 + 14, 80, "N", 26, { align: "center" });
      const credit = text(x0 + 40, y0 + 60 + MAP + 12, MAP,
        `${width >= 1000 ? `${width / 1000} km` : `${width} m`} across, north up. Map data © OpenStreetMap contributors`, 14, { stroke: "#64748b" });
      const rx = x0 + 40 + MAP + 40;
      const sunEl = makeElement("image", rx, y0 + 60, {
        width: SUN, height: SUN, fill: "transparent", stroke: "transparent", z: z + 1,
      }) as ImageElement;
      sunEl.src = sunUrl;
      const sunTitle = text(rx, y0 + 60 + SUN + 16, SUN, "Sun through the year", 20, { font: "sans" });
      const rows = sunTable(place.lat, place.lon, year);
      const table = makeElement("table", rx, y0 + 60 + SUN + 56, {
        width: SUN, height: 36 * rows.length, cells: rows, header: true, fontSize: 14, z: z + 3,
      } as Partial<TableElement>);
      const where = text(rx, y0 + 60 + SUN + 56 + 36 * rows.length + 14, SUN,
        `${ns(place.lat, "N", "S")}, ${ns(place.lon, "E", "W")} · angles in local solar time`, 14, { stroke: "#64748b" });

      onAdd([frame, mapEl, north, northN, credit, sunEl, sunTitle, table, where], frame);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make the site analysis");
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="absolute right-3 top-16 z-20 flex max-h-[calc(100%-5rem)] w-80 max-w-[calc(100vw-24px)] flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-100 p-3">
        <h2 className="flex items-center gap-2 font-semibold"><MapPinned size={16} className="text-rose-700" /> Site analysis</h2>
        <button className="btn-ghost p-1" title="Close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="space-y-3 overflow-y-auto p-3 text-sm">
        <p className="text-xs text-slate-500">
          A site map at its real scale with a north arrow, the sun path for the site and the sun&apos;s angles through the year, in a
          frame of their own.
        </p>
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <input className="input" placeholder="Address, place or 45.46, 9.19" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Site address" />
          <button className="btn-outline px-2.5" title="Find" disabled={busy === "search" || !query.trim()}>
            {busy === "search" ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          </button>
        </form>
        {results && results.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {results.map((r) => (
              <li key={`${r.lat},${r.lon}`}>
                <button className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => { setPlace(r); setResults(null); }}>{r.name}</button>
              </li>
            ))}
          </ul>
        )}
        {place && (
          <div className="rounded-lg bg-slate-50 p-2 text-xs">
            <div className="font-medium text-slate-800">{place.name}</div>
            <div className="text-slate-500">{ns(place.lat, "N", "S")}, {ns(place.lon, "E", "W")}</div>
          </div>
        )}
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-600">Map across</span>
          <select className="rounded-md border border-slate-200 px-1 py-1 text-xs" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {WIDTHS.map((w) => <option key={w} value={w}>{w >= 1000 ? `${w / 1000} km` : `${w} m`}</option>)}
          </select>
        </label>
        <button className="btn-primary w-full justify-center" disabled={!place || !!busy} onClick={build}>
          {busy && busy !== "search" ? <><Loader2 size={15} className="animate-spin" /> {busy}</> : "Add to the board"}
        </button>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <p className="text-[11px] text-slate-400">The place search and the map come from OpenStreetMap; only what you type is sent there.</p>
      </div>
    </aside>
  );
}

