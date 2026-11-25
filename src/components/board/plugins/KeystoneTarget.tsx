"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export type KeystoneProject = { id: string; name: string; city: string | null };
type State = { configured: boolean; connected: boolean; account?: { name: string | null }; projects: KeystoneProject[]; error?: string };

/** The person's Keystone projects and Connect Keystone (in a popup, as in the embed dialog). null while loading. */
export function useKeystoneProjects() {
  const [s, setS] = useState<State | null>(null);
  const [connecting, setConnecting] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/keystone/projects", { cache: "no-store" });
      setS((await r.json()) as State);
    } catch { setS({ configured: true, connected: true, projects: [], error: "Couldn't reach Keystone. Try again" }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const connect = useCallback(() => {
    const w = window.open("/api/keystone/connect?popup=1", "schema-keystone-connect", "width=640,height=780");
    if (!w) { window.location.href = `/api/keystone/connect?next=${encodeURIComponent(window.location.pathname + window.location.search)}`; return; }
    setConnecting(true);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
      setConnecting(false);
      void load();
    };
    const onMessage = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === "schema-keystone-connect") finish(); };
    window.addEventListener("message", onMessage);
    const timer = setInterval(() => { if (w.closed) finish(); }, 700);
  }, [load]);

  return { state: s, connecting, connect, reload: load };
}

/**
 * Where something goes in Keystone: a project picker, or Connect Keystone first. `fixed` is a project the content already
 * belongs to (a sheet Keystone sent): it is picked, and the picker shows it first.
 */
export function KeystoneTarget({ k, value, onChange, fixed }: {
  k: ReturnType<typeof useKeystoneProjects>; value: string; onChange: (id: string) => void; fixed?: { project: string; projectName?: string } | null;
}) {
  const s = k.state;
  const projects = s?.projects ?? [];
  useEffect(() => {
    if (fixed?.project && value !== fixed.project && projects.some((p) => p.id === fixed.project)) onChange(fixed.project);
    else if (!value && projects.length) onChange(projects[0].id);
    // only when what is offered changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixed?.project, projects.length]);

  if (!s) return <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Looking for your Keystone projects…</p>;
  if (!s.configured) return <p className="text-xs text-slate-500">Keystone isn&apos;t set up on this Schema.</p>;
  if (!s.connected) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Connect your Keystone account once to send to its projects.</p>
        <button type="button" className="btn-outline shrink-0 px-2 py-1 text-xs" disabled={k.connecting} onClick={k.connect}>
          {k.connecting ? "Connecting…" : "Connect Keystone"}
        </button>
      </div>
    );
  }
  if (s.error) return <p className="text-xs text-rose-600">{s.error}</p>;
  if (!projects.length) return <p className="text-xs text-slate-500">Your Keystone account has no projects yet. Make one in Keystone first.</p>;
  const known = !!fixed?.project && projects.some((p) => p.id === fixed.project);
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-slate-600">Keystone project</span>
      <select className="w-full rounded-md border border-slate-200 px-1.5 py-1.5 text-xs" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Keystone project">
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.city ? ` · ${p.city}` : ""}{known && p.id === fixed!.project ? " (sheets came from here)" : ""}</option>
        ))}
      </select>
      {fixed?.project && !known && <span className="block text-[11px] text-amber-700">These sheets came from {fixed.projectName ?? fixed.project}, which this Keystone account can&apos;t see.</span>}
    </label>
  );
}
