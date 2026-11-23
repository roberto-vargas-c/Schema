// Site map for the Site analysis plug-in: a place search (OpenStreetMap's Nominatim) and a north-up map picture stitched from
// OpenStreetMap tiles, with its real scale. Both are asked by the browser, once per click, as their usage policies allow.

export type Place = { name: string; lat: number; lon: number };

/** "45.46, 9.19" (or with a space / semicolon) as a place; null when the text isn't coordinates. */
export function parseLatLon(text: string): Place | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return { name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
}

export async function searchPlaces(q: string): Promise<Place[]> {
  const coords = parseLatLon(q);
  if (coords) return [coords];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { "accept-language": navigator.language || "en" } });
  if (!r.ok) throw new Error(`The place search answered ${r.status}. Try again in a moment`);
  const j = (await r.json()) as { display_name: string; lat: string; lon: string }[];
  return j.map((p) => ({ name: p.display_name, lat: Number(p.lat), lon: Number(p.lon) }));
}

const TILE = 256;
const EARTH = 156543.03392; // meters per pixel at zoom 0 on the equator

/** The zoom whose tiles are at least as fine as needed for `widthM` across `px` pixels. */
function zoomFor(lat: number, widthM: number, px: number) {
  const z = Math.floor(Math.log2((EARTH * Math.cos((lat * Math.PI) / 180) * px) / widthM));
  return Math.max(1, Math.min(19, z));
}

/**
 * A square map `widthM` meters across, centered on the place, `px` pixels wide, with a pin in the middle. At most 25 tiles.
 * Returns the PNG and the meters per pixel of the picture.
 */
export async function renderSiteMap(place: Place, widthM: number, px = 1024): Promise<{ blob: Blob; metersPerPx: number }> {
  const z = zoomFor(place.lat, widthM, px);
  const n = 2 ** z;
  const latR = (place.lat * Math.PI) / 180;
  const cx = ((place.lon + 180) / 360) * TILE * n;
  const cy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * TILE * n;
  const mppTile = (EARTH * Math.cos(latR)) / n;
  const span = widthM / mppTile; // in tile pixels
  const x0 = cx - span / 2, y0 = cy - span / 2, k = px / span;
  const cv = document.createElement("canvas");
  cv.width = px; cv.height = px;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, px, px);
  const jobs: Promise<void>[] = [];
  let failed = 0;
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + span) / TILE); ty++) {
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + span) / TILE); tx++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      jobs.push((async () => {
        try {
          const r = await fetch(`https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`, { mode: "cors" });
          if (!r.ok) throw new Error(String(r.status));
          const bmp = await createImageBitmap(await r.blob());
          ctx.drawImage(bmp, (tx * TILE - x0) * k, (ty * TILE - y0) * k, TILE * k + 0.5, TILE * k + 0.5);
          bmp.close();
        } catch { failed++; }
      })());
    }
  }
  await Promise.all(jobs);
  if (failed === jobs.length) throw new Error("Couldn't load the map from OpenStreetMap. Check the connection and try again");
  // the site pin
  const r = px * 0.014;
  ctx.beginPath(); ctx.arc(px / 2, px / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = "#e11d48"; ctx.fill();
  ctx.lineWidth = r * 0.45; ctx.strokeStyle = "#ffffff"; ctx.stroke();
  const blob = await new Promise<Blob>((ok, fail) => cv.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't draw the map"))), "image/png"));
  return { blob, metersPerPx: widthM / px };
}
