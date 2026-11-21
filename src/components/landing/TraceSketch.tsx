import styles from "./landing.module.css";

/*
 * One pencil line wanders in from the left and commits to a form: a building in axonometric, with a podium,
 * a tower with its floor lines, a set-back crown and a mast. Each stroke is drawn in turn at the same
 * pencil speed, then the sheet rests, lifts and starts again.
 *
 * Every stroke is its own path animated with SMIL, because Chrome restarts dash patterns at each "M" in a
 * single path. Visitors who prefer reduced motion get the finished drawing (see the CSS module).
 */

type P3 = [number, number, number];
type P2 = [number, number];

const LOOP = 11; // seconds per cycle
const DRAW = 0.62; // share of the cycle spent drawing; the rest is rest and fade

const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

/** Axonometric (30°) projection at unit scale: x runs right-down, y runs left-down, z runs up. */
const project = ([x, y, z]: P3): P2 => [(x - y) * COS, (x + y) * SIN - z];

// ---- The building, in plan units ----
const A = 3.4, B = 2.4, H1 = 0.9; // podium
const T = { x0: 0.9, x1: 2.5, y0: 0.5, y1: 1.9, z0: H1, z1: 4.7 }; // tower
const C = { x0: 1.3, x1: 2.1, y0: 0.9, y1: 1.5, z0: T.z1, z1: 5.25 }; // crown
const MAST = 5.95;
const FLOORS = 9;

type Box = typeof T;
/** A box standing on something: its visible outline as two strokes, and its silhouette (to hide what is behind). */
function box(b: Box) {
  const L0: P3 = [b.x0, b.y1, b.z0], N0: P3 = [b.x1, b.y1, b.z0], R0: P3 = [b.x1, b.y0, b.z0];
  const L: P3 = [b.x0, b.y1, b.z1], N: P3 = [b.x1, b.y1, b.z1], R: P3 = [b.x1, b.y0, b.z1], K: P3 = [b.x0, b.y0, b.z1];
  return { strokes: [[N0, L0, L, K, R, N, L], [R, R0, N0, N]], silhouette: [L0, N0, R0, R, K, L] };
}

type Piece = { strokes: P3[][]; silhouette?: P3[] };
const pieces: Piece[] = [];

// Podium: the line arrives at its top-left corner, runs around it, then the near corner.
pieces.push({
  strokes: [
    [[0, B, H1], [0, B, 0], [A, B, 0], [A, 0, 0], [A, 0, H1], [0, 0, H1], [0, B, H1], [A, B, H1], [A, 0, H1]],
    [[A, B, 0], [A, B, H1]],
  ],
});
// Tower outline, then its floor lines from the top down, the way you'd hatch them in.
const tower = box(T);
for (let i = FLOORS - 1; i >= 1; i--) {
  const z = T.z0 + ((T.z1 - T.z0) * i) / FLOORS;
  tower.strokes.push([[T.x0, T.y1, z], [T.x1, T.y1, z], [T.x1, T.y0, z]]);
}
pieces.push(tower);
// Crown and mast.
const crown = box(C);
const mx = (C.x0 + C.x1) / 2, my = (C.y0 + C.y1) / 2;
crown.strokes.push([[mx, my, C.z1], [mx, my, MAST]]);
pieces.push(crown);

// ---- Fit the drawing into the right part of the sheet ----
const FIT = { x0: 268, x1: 600, y0: 26, y1: 392 };
const flat = pieces.flatMap((p) => p.strokes.flat()).map(project);
const minX = Math.min(...flat.map((p) => p[0])), maxX = Math.max(...flat.map((p) => p[0]));
const minY = Math.min(...flat.map((p) => p[1])), maxY = Math.max(...flat.map((p) => p[1]));
const scale = Math.min((FIT.x1 - FIT.x0) / (maxX - minX), (FIT.y1 - FIT.y0) / (maxY - minY));
const offX = FIT.x0 + ((FIT.x1 - FIT.x0) - (maxX - minX) * scale) / 2 - minX * scale;
const offY = FIT.y1 - maxY * scale;

/** A tiny, repeatable wobble so ruled lines look drawn by hand. Same 3D point, same wobble. */
const wobble = (p: P3, k: number) => Math.sin((p[0] * 7.1 + p[1] * 3.3 + p[2] * 5.7 + k) * 12.9898) * 0.8;
const toScreen = (p: P3): P2 => {
  const [x, y] = project(p);
  return [x * scale + offX + wobble(p, 1), y * scale + offY + wobble(p, 2)];
};
const n = (v: number) => Math.round(v * 10) / 10;
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---- The wander: loose loops coming in from the left, as cubic Béziers ending on the podium corner ----
type Cubic = [P2, P2, P2, P2];
const [sx, sy] = toScreen(pieces[0].strokes[0][0]);
const wander: Cubic[] = [
  [[14, 250], [52, 196], [104, 196], [112, 236]],
  [[112, 236], [120, 276], [74, 300], [56, 272]],
  [[56, 272], [38, 244], [98, 206], [150, 220]],
  [[150, 220], [196, 232], [188, 302], [160, 306]],
  [[160, 306], [132, 310], [128, 262], [166, 250]],
  [[166, 250], [204, 238], [sx - 60, sy + 50], [sx, sy]],
];
const cubicAt = ([p0, p1, p2, p3]: Cubic, t: number): P2 => {
  const u = 1 - t;
  const f = (i: 0 | 1) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return [f(0), f(1)];
};
const cubicLength = (c: Cubic) => {
  let len = 0, prev = c[0];
  for (let i = 1; i <= 32; i++) { const p = cubicAt(c, i / 32); len += dist(prev, p); prev = p; }
  return len;
};

// ---- Paths and timing: every stroke gets a slot proportional to its length ----
type Drawn = { d: string; len: number };
const pt = (p: P2) => `${n(p[0])} ${n(p[1])}`;
const wanderD = `M ${pt(wander[0][0])}` + wander.map(([, a, b, c]) => ` C ${pt(a)}, ${pt(b)}, ${pt(c)}`).join("");
const wanderLen = wander.reduce((s, c) => s + cubicLength(c), 0);

const polyline = (pts: P3[], fromWander: boolean): Drawn => {
  const s = pts.map(toScreen);
  let len = fromWander ? wanderLen : 0;
  for (let i = 1; i < s.length; i++) len += dist(s[i - 1], s[i]);
  const d = (fromWander ? wanderD : `M ${pt(s[0])}`) + s.slice(1).map((p) => ` L ${pt(p)}`).join("");
  return { d, len };
};

const drawnPieces = pieces.map((p, pi) => ({
  silhouette: p.silhouette?.map(toScreen).map(([x, y]) => `${n(x)},${n(y)}`).join(" "),
  strokes: p.strokes.map((s, si) => polyline(s, pi === 0 && si === 0)),
}));
const total = drawnPieces.reduce((s, p) => s + p.strokes.reduce((t, x) => t + x.len, 0), 0);

let acc = 0;
const timed = drawnPieces.map((p) => {
  const startAt = acc / total;
  const strokes = p.strokes.map((s) => {
    const a = acc / total;
    acc += s.len;
    return { ...s, a, b: acc / total };
  });
  return { ...p, startAt, strokes };
});
const fmt = (v: number) => v.toFixed(4);
/** keyTimes/values for one stroke: wait, draw during [a, b] of the drawing phase, then stay drawn. */
const drawKeys = (a: number, b: number) =>
  a === 0
    ? { keyTimes: `0;${fmt(b * DRAW)};1`, values: "1;0;0" }
    : { keyTimes: `0;${fmt(a * DRAW)};${fmt(b * DRAW)};1`, values: "1;1;0;0" };

// The pencil tip follows the whole drawing, jumping across pen lifts.
const tipPath = timed.flatMap((p) => p.strokes.map((s) => s.d)).join(" ");

// Faint construction lines that settle in once the form is traced: ground axes through the near corner
// and a plumb line through the mast.
const g = (a: P3, b: P3) => `M ${pt(toScreen(a))} L ${pt(toScreen(b))}`;
const guides = [g([-1.4, B, 0], [A + 1.6, B, 0]), g([A, B + 1.2, 0], [A, -1.2, 0]), g([mx, my, -0.4], [mx, my, MAST + 0.3])].join(" ");

const dur = `${LOOP}s`;

function Drawing({ animated }: { animated: boolean }) {
  return (
    <g className={animated ? styles.animated : styles.still} filter="url(#graphite)">
      {animated && <animate attributeName="opacity" dur={dur} repeatCount="indefinite" keyTimes="0;0.9;0.98;1" values="1;1;0;0" />}
      {timed.map((p, pi) => (
        <g key={pi}>
          {p.silhouette && (
            <polygon className={styles.mask} points={p.silhouette}>
              {animated && (
                <animate attributeName="opacity" dur={dur} repeatCount="indefinite"
                  keyTimes={`0;${fmt(p.startAt * DRAW)};${fmt(p.startAt * DRAW + 0.03)};1`} values="0;0;1;1" />
              )}
            </polygon>
          )}
          {p.strokes.map((s, si) => {
            const k = drawKeys(s.a, s.b);
            return [styles.ghost, ""].map((extra) => (
              <path key={`${si}-${extra}`} className={`${styles.stroke} ${extra}`} d={s.d} pathLength={1}>
                {animated && <animate attributeName="stroke-dashoffset" dur={dur} repeatCount="indefinite" calcMode="linear" {...k} />}
              </path>
            ));
          })}
        </g>
      ))}
    </g>
  );
}

export function TraceSketch() {
  return (
    <svg className={styles.sketch} viewBox="0 0 640 420" role="img" aria-label="A pencil line wanders, then traces a tower in three dimensions">
      <defs>
        <filter id="graphite" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.4" />
        </filter>
      </defs>
      <path className={styles.guides} d={guides} />
      <Drawing animated />
      <Drawing animated={false} />
      <circle className={styles.tip} r="2.4">
        <animateMotion dur={dur} repeatCount="indefinite" path={tipPath} keyPoints="0;1;1" keyTimes={`0;${DRAW};1`} calcMode="linear" />
      </circle>
    </svg>
  );
}
