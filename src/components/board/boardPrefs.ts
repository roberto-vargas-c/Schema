"use client";

import { useCallback, useEffect, useState } from "react";
import type { WheelMode } from "./Canvas";

export type GridStyle = "dots" | "lines" | "none";

/** Board view settings. Each person's choices are kept in their browser and apply to every board. */
export type BoardPrefs = {
  grid: GridStyle;
  showCursors: boolean;
  showComments: boolean;
  showDimensions: boolean;
  showUndoRedo: boolean;
  showConnectors: boolean;
  showAuthors: boolean;
  wheelMode: WheelMode;
  reduceMotion: boolean;
  /** Make new pictures and PDF pages lighter as the board fills up. */
  autoImageQuality: boolean;
};

export const DEFAULT_PREFS: BoardPrefs = {
  grid: "dots",
  showCursors: true,
  showComments: true,
  showDimensions: false,
  showUndoRedo: true,
  showConnectors: true,
  showAuthors: false,
  wheelMode: "auto",
  reduceMotion: false,
  autoImageQuality: true,
};

const ALLOWED: Partial<Record<keyof BoardPrefs, readonly string[]>> = {
  grid: ["dots", "lines", "none"],
  wheelMode: ["auto", "zoom", "pan"],
};

// Stored one key per setting ("schema.showAuthors", "schema.wheelMode", …) so the two settings
// that already existed keep their saved values.
const keyFor = (k: keyof BoardPrefs) => `schema.${k}`;

function read(): BoardPrefs {
  const out = { ...DEFAULT_PREFS };
  try {
    out.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { /* ignore */ }
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof BoardPrefs)[]) {
    let raw: string | null = null;
    try { raw = localStorage.getItem(keyFor(k)); } catch { /* private mode */ }
    if (raw == null) continue;
    if (typeof DEFAULT_PREFS[k] === "boolean") (out as Record<string, unknown>)[k] = raw === "1";
    else if (ALLOWED[k]?.includes(raw)) (out as Record<string, unknown>)[k] = raw;
  }
  return out;
}

export function useBoardPrefs() {
  const [prefs, setPrefs] = useState<BoardPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    setPrefs(read());
    // Another tab changed a setting: follow it.
    const onStorage = (e: StorageEvent) => { if (e.key?.startsWith("schema.")) setPrefs(read()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const setPref = useCallback(<K extends keyof BoardPrefs>(k: K, v: BoardPrefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    try { localStorage.setItem(keyFor(k), typeof v === "boolean" ? (v ? "1" : "0") : String(v)); } catch { /* private mode */ }
  }, []);
  return [prefs, setPref] as const;
}
