import styles from "./landing.module.css";

/*
 * One smooth pencil line drifting across the sheet in long, easy curves: no corners, no loops.
 * A single continuous path, so a CSS dash animation can trace it (see the CSS module for timing).
 */
const D = [
  "M 20 292",
  "C 96 300, 140 196, 222 184",
  "S 330 262, 404 236",
  "S 482 126, 556 140",
  "S 606 154, 628 166",
].join(" ");

export function TraceSketch() {
  return (
    <svg className={styles.sketch} viewBox="0 0 640 420" role="img" aria-label="A smooth pencil line drawing itself across a sheet of tracing paper">
      <defs>
        <filter id="graphite" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.4" />
        </filter>
      </defs>
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
