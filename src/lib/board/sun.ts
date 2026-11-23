// Sun position and a sun path diagram for the Site analysis plug-in. Low-precision solar formulas (good to about 0.1°),
// worked in local solar time so no time zone is needed: 12:00 is when the sun is due south (or north) of the site.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Days since J2000.0 for a UTC time. */
const daysJ2000 = (utcMs: number) => utcMs / 86400000 + 2440587.5 - 2451545.0;

/** The sun's declination and right ascension (degrees) on a day. */
function sunCoords(d: number) {
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  return {
    dec: Math.asin(Math.sin(e) * Math.sin(L)) * DEG,
    ra: Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * DEG,
    gmst: 18.697374558 + 24.06570982441908 * d,
  };
}

/** Altitude above the horizon and azimuth (from north, clockwise), in degrees, at a UTC time. */
export function sunPosition(utcMs: number, lat: number, lon: number) {
  const d = daysJ2000(utcMs);
  const { dec, ra, gmst } = sunCoords(d);
  const H = ((gmst * 15 + lon - ra) % 360) * RAD;
  const phi = lat * RAD, delta = dec * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H)) * DEG;
  const az = Math.atan2(-Math.sin(H) * Math.cos(delta), Math.sin(delta) * Math.cos(phi) - Math.cos(delta) * Math.cos(H) * Math.sin(phi)) * DEG;
  return { alt, az: (az + 360) % 360 };
}

/** UTC time at a local solar hour on a day (the date's year, month, day; hour 0–24). */
export function solarTimeUtc(year: number, month: number, day: number, hour: number, lon: number) {
  return Date.UTC(year, month - 1, day) + (hour - lon / 15) * 3600000;
}

export type DayFacts = { dayLength: number; noonAlt: number; riseAz: number | null; setAz: number | null; polar: "day" | "night" | null };

/** Day length (hours), the sun's height at solar noon and where it rises and sets (azimuth, degrees). */
export function dayFacts(year: number, month: number, day: number, lat: number, lon: number): DayFacts {
  const { dec } = sunCoords(daysJ2000(solarTimeUtc(year, month, day, 12, lon)));
  const phi = lat * RAD, delta = dec * RAD, h0 = -0.833 * RAD;
  const noonAlt = 90 - Math.abs(lat - dec);
  const cosH0 = (Math.sin(h0) - Math.sin(phi) * Math.sin(delta)) / (Math.cos(phi) * Math.cos(delta));
  if (cosH0 <= -1) return { dayLength: 24, noonAlt, riseAz: null, setAz: null, polar: "day" };
  if (cosH0 >= 1) return { dayLength: 0, noonAlt, riseAz: null, setAz: null, polar: "night" };
  const H0 = Math.acos(cosH0) * DEG;
  const cosA = (Math.sin(delta) - Math.sin(phi) * Math.sin(h0)) / (Math.cos(phi) * Math.cos(h0));
  const riseAz = Math.acos(Math.max(-1, Math.min(1, cosA))) * DEG;
  return { dayLength: (2 * H0) / 15, noonAlt, riseAz, setAz: 360 - riseAz, polar: null };
}

export const formatHours = (h: number) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

export const KEY_DAYS: { label: string; month: number; day: number; color: string }[] = [
  { label: "21 June", month: 6, day: 21, color: "#ea580c" },
  { label: "21 March / 23 September", month: 3, day: 21, color: "#ca8a04" },
  { label: "21 December", month: 12, day: 21, color: "#2563eb" },
];

/**
 * A sun path diagram as SVG: the sky seen from above, north up, the horizon as the outer ring and the zenith in the middle
 * (equidistant). The paths of the sun on the solstices and the equinoxes, with the solar hours marked.
 */
export function sunPathSvg(lat: number, lon: number, year: number, size = 1200) {
  const c = size / 2, R = size * 0.4;
  const pt = (alt: number, az: number) => {
    const r = ((90 - alt) / 90) * R;
    return { x: c + r * Math.sin(az * RAD), y: c - r * Math.cos(az * RAD) };
  };
  const f = (n: number) => n.toFixed(1);
  const parts: string[] = [];
  parts.push(`<rect width="${size}" height="${size}" fill="#ffffff"/>`);
  // altitude rings every 15°, azimuth spokes every 30°
  for (let a = 0; a < 90; a += 15) {
    const r = ((90 - a) / 90) * R;
    parts.push(`<circle cx="${c}" cy="${c}" r="${f(r)}" fill="none" stroke="${a === 0 ? "#334155" : "#cbd5e1"}" stroke-width="${a === 0 ? 3 : 1.5}"/>`);
    if (a > 0) parts.push(`<text x="${c + 6}" y="${f(c - r - 6)}" font-size="${size * 0.018}" fill="#94a3b8">${a}°</text>`);
  }
  for (let az = 0; az < 360; az += 30) {
    const o = pt(0, az);
    parts.push(`<line x1="${c}" y1="${c}" x2="${f(o.x)}" y2="${f(o.y)}" stroke="#e2e8f0" stroke-width="1.5"/>`);
    const l = pt(-9, az);
    const name = ({ 0: "N", 90: "E", 180: "S", 270: "W" } as Record<number, string>)[az];
    parts.push(`<text x="${f(l.x)}" y="${f(l.y)}" font-size="${size * (name ? 0.034 : 0.02)}" font-weight="${name ? 700 : 400}" fill="${name ? "#0f172a" : "#64748b"}" text-anchor="middle" dominant-baseline="central">${name ?? az + "°"}</text>`);
  }
  // hour lines: the same solar hour across the three days
  const hours: Record<number, { x: number; y: number }[]> = {};
  for (const k of KEY_DAYS) {
    const path: string[] = [];
    let up = false;
    for (let m = 0; m <= 24 * 60; m += 5) {
      const p = sunPosition(solarTimeUtc(year, k.month, k.day, m / 60, lon), lat, lon);
      if (p.alt < 0) { up = false; continue; }
      const q = pt(p.alt, p.az);
      path.push(`${up ? "L" : "M"}${f(q.x)} ${f(q.y)}`);
      up = true;
      if (m % 60 === 0) (hours[m / 60] ??= []).push(q);
    }
    if (path.length) parts.push(`<path d="${path.join(" ")}" fill="none" stroke="${k.color}" stroke-width="${size * 0.006}" stroke-linecap="round"/>`);
  }
  for (const [h, qs] of Object.entries(hours)) {
    if (qs.length > 1) parts.push(`<polyline points="${qs.map((q) => `${f(q.x)},${f(q.y)}`).join(" ")}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 6"/>`);
    for (const q of qs) parts.push(`<circle cx="${f(q.x)}" cy="${f(q.y)}" r="${size * 0.006}" fill="#0f172a"/>`);
    const top = qs[0];
    parts.push(`<text x="${f(top.x)}" y="${f(top.y - size * 0.02)}" font-size="${size * 0.02}" fill="#0f172a" text-anchor="middle">${h}h</text>`);
  }
  // legend
  KEY_DAYS.forEach((k, i) => {
    const y = size - size * 0.035 * (KEY_DAYS.length - i);
    parts.push(`<line x1="${size * 0.04}" y1="${f(y)}" x2="${size * 0.09}" y2="${f(y)}" stroke="${k.color}" stroke-width="${size * 0.006}"/>`);
    parts.push(`<text x="${size * 0.1}" y="${f(y)}" font-size="${size * 0.02}" fill="#334155" dominant-baseline="central">${k.label}</text>`);
  });
  parts.push(`<text x="${size * 0.96}" y="${size * 0.965}" font-size="${size * 0.018}" fill="#64748b" text-anchor="end">Local solar time · ${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif">${parts.join("")}</svg>`;
}

/** Draws an SVG string to a PNG blob in the browser. */
export async function svgToPng(svg: string, size: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
    const cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    cv.getContext("2d")!.drawImage(img, 0, 0, size, size);
    return await new Promise((ok, fail) => cv.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't draw the sun path"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
