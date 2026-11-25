"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRightLeft, Check, CircleAlert, Loader2, X } from "lucide-react";
import { MiroAccount, copyMiroImages, describeSkipped, useMiroConnections } from "@/components/board/MiroImport";
import type { BoardElement } from "@/lib/board/types";

type MiroBoard = { id: string; name: string; teamId: string; teamName: string | null; modifiedAt?: string; owner?: string };
type Status = { state: "waiting" | "running" | "done" | "failed"; note?: string; boardId?: string };

/** "Migrate from Miro": lists every board in the connected Miro teams and copies all of them, or the ones picked, into this workspace. */
export function MigrateFromMiro({ workspaceId, folderId = "" }: { workspaceId: string; folderId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-ghost ring-1 ring-slate-200" onClick={() => setOpen(true)}><ArrowRightLeft size={16} /> Migrate from Miro</button>
      {open && <MigrateDialog workspaceId={workspaceId} folderId={folderId} onClose={() => setOpen(false)} />}
    </>
  );
}

function MigrateDialog({ workspaceId, folderId, onClose }: { workspaceId: string; folderId: string; onClose: () => void }) {
  const router = useRouter();
  const miro = useMiroConnections();
  const [boards, setBoards] = useState<MiroBoard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failedTeams, setFailedTeams] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const connected = miro.connections.length > 0;
  const teamKey = miro.connections.map((c) => c.id).join(",");

  useEffect(() => {
    if (!connected) return;
    let live = true;
    setBoards(null); setLoadError(null);
    fetch("/api/miro/boards", { cache: "no-store" }).then(async (res) => {
      const j = await res.json().catch(() => ({}));
      if (!live) return;
      if (!res.ok) { setLoadError(j.error ?? "Couldn't list your Miro boards"); if (j.needsConnect) miro.refresh(); return; }
      setBoards(j.boards); setFailedTeams(j.failedTeams ?? []);
      setPicked(new Set((j.boards as MiroBoard[]).map((b) => b.id)));
    }).catch(() => live && setLoadError("Couldn't reach Miro. Try again"));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, teamKey]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (boards ?? []).filter((b) => !f || b.name.toLowerCase().includes(f) || (b.teamName ?? "").toLowerCase().includes(f));
  }, [boards, filter]);
  const teams = new Set((boards ?? []).map((b) => b.teamId)).size;
  const started = Object.keys(status).length > 0;
  const allShownPicked = shown.length > 0 && shown.every((b) => picked.has(b.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleShown = () => setPicked((p) => {
    const n = new Set(p);
    for (const b of shown) { if (allShownPicked) n.delete(b.id); else n.add(b.id); }
    return n;
  });

  const run = async () => {
    const queue = (boards ?? []).filter((b) => picked.has(b.id) && status[b.id]?.state !== "done");
    if (!queue.length) return;
    stop.current = false;
    setRunning(true);
    setStatus((s) => ({ ...s, ...Object.fromEntries(queue.map((b) => [b.id, { state: "waiting" } as Status])) }));
    for (const b of queue) {
      if (stop.current) break;
      setStatus((s) => ({ ...s, [b.id]: { state: "running" } }));
      let st: Status;
      const api = (body: object) => fetch(`/api/workspaces/${workspaceId}/import/miro`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }).then(async (res) => { const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`); return j; });
      let created: string | null = null;
      try {
        const j = await api({ step: "start", miroBoardId: b.id, folderId: folderId || undefined });
        created = j.boardId;
        const images = (j.images ?? []) as { elementId: string; miroUrl: string }[];
        const copied = await copyMiroImages(j.boardId, b.id, j.elements as BoardElement[], images, {
          onProgress: (d, n) => { if (n) setStatus((s) => ({ ...s, [b.id]: { state: "running", note: `Copying pictures ${Math.min(d + 1, n)} of ${n}` } })); },
        });
        if (!copied.elements.length) throw new Error(images.length ? `Couldn't copy the pictures: ${copied.firstError}` : "Miro didn't return anything Schema can import from this board");
        setStatus((s) => ({ ...s, [b.id]: { state: "running", note: "Saving" } }));
        await api({ step: "finish", boardId: j.boardId, elements: copied.elements });
        const skipped = describeSkipped(j.skipped);
        const notes = [
          `${copied.elements.length} item${copied.elements.length === 1 ? "" : "s"}`,
          skipped ? `skipped ${skipped}${j.skipped?.paint ? " (Miro doesn't share freehand drawings with apps)" : ""}` : "",
          copied.failed ? `${copied.failed} picture${copied.failed === 1 ? "" : "s"} couldn't be copied (${copied.firstError})` : "",
          j.truncated ? "first 3000 items only" : "",
        ].filter(Boolean).join(", ");
        st = { state: "done", boardId: j.boardId, note: notes };
      } catch (e) {
        if (created) await api({ step: "cancel", boardId: created }).catch(() => {});
        st = { state: "failed", note: e instanceof Error ? e.message : "failed" };
      }
      setStatus((s) => ({ ...s, [b.id]: st }));
    }
    // Boards left waiting after Stop go back to unstarted.
    setStatus((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v.state !== "waiting")));
    setRunning(false);
    router.refresh();
  };

  const counts = Object.values(status).reduce((a, s) => { a[s.state] = (a[s.state] ?? 0) + 1; return a; }, {} as Record<string, number>);
  const todo = (boards ?? []).filter((b) => picked.has(b.id) && status[b.id]?.state !== "done").length;
  const when = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return isNaN(+d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => { if (!running) onClose(); }}>
      <div className="card flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Migrate from Miro</h2>
          <button type="button" className="btn-ghost p-1" onClick={onClose} disabled={running}><X size={18} /></button>
        </div>
        <p className="text-sm text-slate-600">
          Copies your Miro boards into this workspace{folderId ? " (in this folder)" : ""} as new boards. Each keeps its sticky notes, shapes,
          text, frames, cards, images, links and connectors. Your Miro boards aren&apos;t changed.
        </p>

        {miro.available === false && <p className="text-sm text-rose-600">Connect Miro isn&apos;t set up on this server yet (MIRO_CLIENT_ID and MIRO_CLIENT_SECRET).</p>}
        {miro.available && !running && <MiroAccount miro={miro} />}

        {connected && !boards && !loadError && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Getting your Miro boards…</p>}
        {loadError && <p className="text-sm text-rose-600">{loadError}</p>}
        {failedTeams.length > 0 && <p className="text-sm text-amber-700">Couldn&apos;t list the boards in {failedTeams.join(", ")}. Try connecting {failedTeams.length === 1 ? "that team" : "those teams"} again.</p>}

        {boards && boards.length === 0 && <p className="text-sm text-slate-500">No boards found in your connected Miro {miro.connections.length === 1 ? "team" : "teams"}.</p>}
        {boards && boards.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={allShownPicked} onChange={toggleShown} disabled={running} />
                {filter ? "Select all shown" : `Select all ${boards.length}`}
              </label>
              <input className="input ml-auto w-48" placeholder="Filter boards" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <ul className="-mx-1 min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {shown.map((b) => {
                const s = status[b.id];
                return (
                  <li key={b.id} className="flex items-center gap-3 px-1 py-2 text-sm">
                    <input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)} disabled={running || s?.state === "done"} aria-label={`Import ${b.name}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-800">{b.name}</div>
                      <div className="truncate text-xs text-slate-500">
                        {[teams > 1 ? b.teamName : null, b.owner, when(b.modifiedAt) && `edited ${when(b.modifiedAt)}`].filter(Boolean).join(" · ")}
                      </div>
                      {s?.note && <div className={`text-xs ${s.state === "failed" ? "text-rose-600" : "text-slate-500"}`}>{s.note}</div>}
                    </div>
                    <span className="shrink-0">
                      {s?.state === "waiting" && <span className="text-xs text-slate-400">Waiting</span>}
                      {s?.state === "running" && <Loader2 size={16} className="animate-spin text-slate-500" />}
                      {s?.state === "done" && <Link href={`/board/${s.boardId}`} className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"><Check size={14} /> Open</Link>}
                      {s?.state === "failed" && <span className="flex items-center gap-1 text-xs text-rose-600"><CircleAlert size={14} /> Failed</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {started && (
            <p className="mr-auto text-sm text-slate-600">
              {counts.done ?? 0} imported{counts.failed ? `, ${counts.failed} failed` : ""}
              {running ? `, ${(counts.waiting ?? 0) + (counts.running ?? 0)} to go` : ""}
            </p>
          )}
          {running
            ? <button type="button" className="btn-ghost" onClick={() => { stop.current = true; }}>Stop after this board</button>
            : <button type="button" className="btn-ghost" onClick={onClose}>{started ? "Close" : "Cancel"}</button>}
          {boards && boards.length > 0 && !running && (
            <button type="button" className="btn-primary" disabled={!todo} onClick={run}>
              {counts.failed && todo === counts.failed ? `Retry ${todo} failed` : `Import ${todo === boards.length ? "all " : ""}${todo} board${todo === 1 ? "" : "s"}`}
            </button>
          )}
          {running && <button type="button" className="btn-primary" disabled><Loader2 size={16} className="animate-spin" /> Importing…</button>}
        </div>
      </div>
    </div>
  );
}
