import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import { TraceSketch } from "@/components/landing/TraceSketch";
import styles from "@/components/landing/landing.module.css";
import { currentUser } from "@/lib/session";

const sans = Geist({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--lp-sans" });
const mono = Geist_Mono({ subsets: ["latin"], weight: "400", variable: "--lp-mono" });

export const metadata: Metadata = {
  title: "Schematrace — trace the idea",
  description: "A quiet canvas for sketches, schemas and the first stroke of a building.",
};

export default async function Home() {
  if (await currentUser()) redirect("/w");
  return (
    <div className={`${styles.page} ${sans.variable} ${mono.variable}`}>
      <header className={styles.bar}>
        <span className={styles.mark}>schema<span>trace</span></span>
        <Link className={styles.link} href="/login">Log in</Link>
      </header>

      <main className={styles.main}>
        <section>
          <p className={styles.eyebrow}>Sheet 01 · Concept</p>
          <h1 className={styles.title}>Trace<br /><em>the idea.</em></h1>
          <p className={styles.lede}>
            A quiet canvas for sketches, schemas and the first stroke of a building. Lay one idea over another, together.
          </p>
          <div className={styles.actions}>
            <Link className={styles.cta} href="/signup">Start tracing <span aria-hidden>→</span></Link>
            <Link className={styles.link} href="/login">I have an account</Link>
          </div>
        </section>

        <figure className={styles.sheet}>
          <span className={styles.tape} aria-hidden />
          <TraceSketch />
          <figcaption className={styles.sheetMeta}>Sketch · n.t.s.</figcaption>
        </figure>
      </main>

      <footer className={styles.foot}>
        <span>schematrace.app</span>
        <span className={styles.scale} aria-hidden>
          <span className={styles.scaleBar}><i /><i /><i /><i /></span>
          1:100
        </span>
      </footer>
    </div>
  );
}
