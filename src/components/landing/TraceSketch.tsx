import styles from "./landing.module.css";

/*
 * A loose pencil scribble, drawn as one line: a long sweep in, a burst of quick back-and-forth strokes,
 * a single small turn, and a flick off the paper. One continuous path, so a CSS dash animation can trace it
 * (see the CSS module for timing).
 */
const D = [
  "M 24 286",
  "C 92 214, 168 160, 236 176", // long sweep in
  "C 270 184, 296 160, 318 142", // and up
  // quick back-and-forth, like shading a corner of an idea
  "L 262 214 L 346 150 L 284 238 L 370 168 L 306 262 L 392 192 L 336 278",
  "C 380 262, 424 214, 452 172",
  "C 476 134, 530 128, 528 166", // one small turn
  "C 526 206, 470 208, 478 176",
  "C 488 138, 566 150, 588 214", // and the flick off the paper
  "C 600 250, 596 290, 616 318",
].join(" ");

export function TraceSketch() {
  return (
    <svg className={styles.sketch} viewBox="0 0 640 420" role="img" aria-label="A pencil scribble drawing itself across a sheet of tracing paper">
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
