import styles from "./landing.module.css";

/*
 * A side elevation, drawn as one line: the pencil drifts in with a single loose turn, settles onto the
 * ground line, rises into the profile of a building (a low plinth, a tower with a sloped roof, a
 * cantilevered slab), comes back down and runs off along the ground before it lifts.
 * One continuous path, so a CSS dash animation can trace it (see the CSS module for timing).
 */

type P = [number, number];

const G = 352; // ground line

// The building profile, left to right, in screen units of the 640×420 sheet.
const profile: P[] = [
  [236, G],
  [262, G], [262, 292], // plinth
  [306, 292], [306, 132], // tower, left face
  [376, 62], // sloped roof
  [376, 204], // tower, right face down to the slab
  [492, 204], [492, 224], // cantilever
  [414, 224], [414, G], // back under the slab, down to the ground
  [566, G], // ground runs on
];

/** A tiny, repeatable wobble so ruled lines look drawn by hand. */
const wobble = (i: number) => Math.sin(i * 12.9898) * 0.7;
const n = (v: number) => Math.round(v * 10) / 10;

const D =
  // One loose turn, then down onto the ground line.
  `M 16 214 C 70 168, 150 170, 156 214 S 104 262, 98 236 S 150 196, 188 262 ` +
  `C 204 290, 214 ${G}, ${profile[0][0]} ${G}` +
  profile.slice(1).map(([x, y], i) => ` L ${n(x + wobble(i))} ${n(y + wobble(i + 9))}`).join("") +
  // Lift off the paper.
  ` C 590 ${G}, 606 ${G - 8}, 618 ${G - 26}`;

// Faint construction lines that settle in once the profile is traced, plus a figure for scale.
const guides = [
  `M 8 ${G} L 632 ${G}`, // ground, ruled across the sheet
  `M 341 ${G + 22} L 341 36`, // tower axis
  `M 250 62 L 420 62`, // roof level
  `M 250 204 L 520 204`, // slab level
].join(" ");
const figure = `M 528 ${G - 30} m -3 0 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0 M 528 ${G - 27} L 528 ${G - 13} L 525 ${G} M 528 ${G - 13} L 531 ${G} M 524 ${G - 22} L 532 ${G - 22}`;

export function TraceSketch() {
  return (
    <svg className={styles.sketch} viewBox="0 0 640 420" role="img" aria-label="A pencil line drifts in and traces the side elevation of a building">
      <defs>
        <filter id="graphite" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.4" />
        </filter>
      </defs>
      <path className={styles.guides} d={guides} />
      <path className={styles.figure} d={figure} />
      <g filter="url(#graphite)">
        <path className={`${styles.stroke} ${styles.ghost}`} d={D} pathLength={1} />
        <path className={styles.stroke} d={D} pathLength={1} />
      </g>
      <circle className={styles.tip} r="2.4">
        <animateMotion dur="11s" repeatCount="indefinite" path={D} keyPoints="0;1;1" keyTimes="0;0.62;1" calcMode="linear" />
      </circle>
    </svg>
  );
}
