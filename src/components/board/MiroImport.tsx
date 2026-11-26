"use client";
import { useCallback, useEffect, useState } from "react";
import { X, Loader2, Link2, Unlink } from "lucide-react";
import type { BoardElement, ConnectorElement } from "@/lib/board/types";

type MiroConnection = { id: string; teamId: string; teamName: string | null };

/** The Miro teams this person connected with "Connect Miro", and whether the server offers it. */
export function useMiroConnections() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<MiroConnection[]>([]);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/miro/connections", { cache: "no-store" });
      if (!res.ok) { setAvailable(false); return; }
      const j = await res.json();
      setAvailable(!!j.available);
      setConnections(j.connections ?? []);
    } catch { setAvailable(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  /** Opens Miro's sign-in in a small window; resolves true once a team is connected. */
  const connect = useCallback(() => new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const w = window.open("/api/miro/connect?popup=1", "schema-miro-connect", "width=640,height=780");
    if (!w) {
      // Popup blocked: go through the sign-in in this tab and come back here.
      window.location.href = `/api/miro/connect?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    let done = false;
    const finish = (r: { ok: boolean; error?: string }) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
      refresh().then(() => resolve(r));
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "schema-miro-connect") return;
      finish({ ok: !!e.data.ok, error: e.data.error });
    };
    window.addEventListener("message", onMessage);
    const timer = setInterval(() => { if (w.closed) finish({ ok: false }); }, 700);
  }), [refresh]);

  const disconnect = useCallback(async (id: string) => {
    await fetch(`/api/miro/connections?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    await refresh();
  }, [refresh]);

  return { available, connections, connect, disconnect, refresh };
}

/** "Connect Miro" button, or the connected teams with a way to add another or disconnect. */
export function MiroAccount({ miro, onConnected }: { miro: ReturnType<typeof useMiroConnections>; onConnected?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setError(null);
    const r = await miro.connect();
    setBusy(false);
    if (r.ok) onConnected?.();
    else if (r.error) setError(r.error);
  };
  if (!miro.connections.length) {
    return (
      <div className="space-y-2">
        <button type="button" className="btn-primary w-full justify-center" onClick={go} disabled={busy}>
          {busy ? <><Loader2 size={16} className="animate-spin" /> Waiting for Miro…</> : <><Link2 size={16} /> Connect Miro</>}
        </button>
        <p className="text-xs text-slate-500">Sign in to Miro once and pick your team. Schema keeps the connection for your next paste or import.</p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
      <p className="font-medium text-slate-700">Connected to Miro</p>
      <ul className="mt-1 space-y-1">
        {miro.connections.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="truncate">{c.teamName ?? "Miro team"}</span>
            <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => miro.disconnect(c.id)} title="Disconnect"><Unlink size={14} /> Disconnect</button>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-2 text-xs font-medium text-teal-700 hover:underline disabled:opacity-50" onClick={go} disabled={busy}>
        {busy ? "Waiting for Miro…" : "Connect another Miro team"}
      </button>
      {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
    </div>
  );
}

const SKIPPED_NAMES: Record<string, [string, string]> = {
  paint: ["drawing", "drawings"], connector: ["connector", "connectors"], mindmap_node: ["mind map node", "mind map nodes"],
  table: ["table", "tables"], table_text: ["table text", "table texts"], data_table_format: ["table", "tables"], preview: ["link preview", "link previews"],
  doc_format: ["doc", "docs"], comment: ["comment", "comments"], kanban: ["kanban", "kanbans"], unsupported: ["other item", "other items"],
};
/** "112 drawings and 5 connectors", from the import's skipped counts. */
export function describeSkipped(skipped: Record<string, number> | undefined): string {
  const parts = Object.entries(skipped ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => { const [one, many] = SKIPPED_NAMES[k] ?? [k.replace(/_/g, " "), `${k.replace(/_/g, " ")}s`]; return `${n} ${n === 1 ? one : many}`; });
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Copies a Miro board's pictures into a Schema board, one request each (keeps every request small
 * enough for the server's limits), and answers the elements with their pictures filled in. Pictures
 * that can't be copied are left out and counted.
 */
export async function copyMiroImages(
  schemaBoardId: string, miroBoardId: string, elements: BoardElement[], images: { elementId: string; miroUrl: string }[],
  opts: { q?: string; token?: string; onProgress?: (done: number, total: number) => void; shouldStop?: () => boolean } = {},
): Promise<{ elements: BoardElement[]; failed: number; firstError?: string }> {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const drop = new Set<string>();
  let failed = 0, firstError: string | undefined;
  for (const [i, img] of images.entries()) {
    opts.onProgress?.(i, images.length);
    if (opts.shouldStop?.()) { drop.add(img.elementId); failed++; continue; }
    try {
      // Busy or briefly failing servers (Miro's or ours) get a few more tries, a little later each time.
      let res: Response | null = null, j: { src?: string; animated?: boolean; error?: string } = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
        res = await fetch(`/api/boards/${schemaBoardId}/import/miro/image${opts.q ?? ""}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ board: miroBoardId, url: img.miroUrl, token: opts.token || undefined }),
        }).catch(() => null);
        j = res ? await res.json().catch(() => ({})) : {};
        if (res && (res.ok || (res.status !== 429 && res.status < 500))) break;
      }
      if (!res?.ok || !j.src) throw new Error(j.error ?? (res ? `the server answered ${res.status}` : "no connection"));
      const el = byId.get(img.elementId);
      if (el) byId.set(el.id, { ...el, src: j.src, animated: j.animated } as BoardElement);
    } catch (e) {
      failed++;
      firstError ??= e instanceof Error ? e.message : "failed";
      drop.add(img.elementId);
    }
  }
  opts.onProgress?.(images.length, images.length);
  return { elements: elements.filter((e) => !drop.has(e.id)).map((e) => byId.get(e.id)!), failed, firstError };
}

/** Imports a whole Miro board through Miro's API, with the connected Miro account or a token pasted by hand. */
export function MiroDialog({ boardId, q, at, onImport, onClose }: {
  boardId: string; q: string; at: { x: number; y: number };
  onImport: (els: BoardElement[], note: string) => void; onClose: () => void;
}) {
  const miro = useMiroConnections();
  const [link, setLink] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const oauth = miro.available === true;
  const ready = !oauth || miro.connections.length > 0 || token.trim().length > 0;

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}/import/miro${q}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ link, token: token.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.needsConnect) miro.refresh();
      if (!res.ok) throw new Error(j.error ?? "Import failed");
      const copied = await copyMiroImages(boardId, j.miroBoardId, j.elements as BoardElement[], j.images ?? [], {
        q, token: token.trim() || undefined, onProgress: (d, n) => n && setProgress(`Copying pictures ${Math.min(d + 1, n)}/${n}…`),
      });
      setProgress(null);
      const els = copied.elements;
      j.imageFailures = copied.failed;
      if (!els.length) throw new Error("That board has nothing Schema can import");
      // Center the imported content on the current view.
      const placed = els.filter((x) => x.type !== "connector");
      const w = Math.max(...placed.map((x) => x.x + x.width)), h = Math.max(...placed.map((x) => x.y + x.height));
      const dx = at.x - w / 2, dy = at.y - h / 2, z = Date.now();
      const moved = els.map((x, i) => x.type === "connector"
        ? { ...x, z: z + i, from: { ...(x as ConnectorElement).from, x: (x as ConnectorElement).from.x + dx, y: (x as ConnectorElement).from.y + dy }, to: { ...(x as ConnectorElement).to, x: (x as ConnectorElement).to.x + dx, y: (x as ConnectorElement).to.y + dy } }
        : { ...x, x: x.x + dx, y: x.y + dy, z: x.type === "frame" ? z - 1000 + i : z + i });
      const skipped = describeSkipped(j.skipped);
      const notes = [
        `Imported ${els.length} items from “${j.name}”.`,
        skipped ? `Skipped ${skipped}${j.skipped?.paint ? " (Miro doesn't share freehand drawings with apps)" : ""}.` : "",
        describeSkipped(j.placeholders) ? `${describeSkipped(j.placeholders)} kept as labelled boxes (Miro doesn't share what's in them).` : "",
        j.imageFailures ? `${j.imageFailures} image${j.imageFailures === 1 ? "" : "s"} couldn't be copied.` : "",
        j.truncated ? "Only the first 3000 items were imported." : "",
      ].filter(Boolean).join(" ");
      setToken("");
      onImport(moved as BoardElement[], notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally { setBusy(false); setProgress(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form className="card max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-5" onClick={(e) => e.stopPropagation()} onSubmit={run}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import a Miro board</h2>
          <button type="button" className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="text-sm text-slate-600">
          Brings over sticky notes, shapes, text, frames, cards, images, links and connectors with their positions and colors.
          Drawings, tables, mind maps and comments aren&apos;t available through Miro&apos;s API.
        </p>
        <div>
          <label className="label" htmlFor="miro-link">Miro board link</label>
          <input id="miro-link" className="input" value={link} onChange={(e) => setLink(e.target.value)} required autoFocus
            placeholder="https://miro.com/app/board/…" />
        </div>
        {oauth && <MiroAccount miro={miro} />}
        {miro.available !== null && (oauth ? (
          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer text-slate-500">Use an access token instead</summary>
            <div className="mt-2 space-y-2"><TokenField id="miro-token" token={token} setToken={setToken} /><MiroTokenHelp /></div>
          </details>
        ) : (
          <><TokenField id="miro-token" token={token} setToken={setToken} required /><MiroTokenHelp /></>
        ))}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !ready}>{busy ? <><Loader2 size={16} className="animate-spin" /> {progress ?? "Importing…"}</> : "Import"}</button>
        </div>
      </form>
    </div>
  );
}


function TokenField({ id, token, setToken, required }: { id: string; token: string; setToken: (t: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={id}>Miro access token</label>
      <input id={id} className="input font-mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required={required} />
      <p className="mt-1 text-xs text-slate-500">Used for this import only. It isn&apos;t saved.</p>
    </div>
  );
}

/** Steps for getting a Miro access token, shared by the import and paste dialogs. */
export function MiroTokenHelp() {
  return (
    <details className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">How to get a token (once, about 2 minutes)</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>In Miro, open your profile picture → <b>Settings</b> → <b>Your apps</b>, and choose <b>Create new app</b> (accept the developer team prompt if Miro shows one).</li>
        <li>Under <b>Permissions</b>, tick <b>boards:read</b>.</li>
        <li>Click <b>Install app and get OAuth token</b>, pick the team that has the board, and copy the token it shows.</li>
      </ol>
      <p className="mt-2">You can keep the app and reuse the same token for other boards in that team.</p>
    </details>
  );
}

const TOKEN_KEY = "schema.miroToken";
let sessionToken: string | null = null;
/** The Miro token for pasting: kept in memory for this tab, or in this browser when the person chose that. */
export function getMiroToken(): string | null {
  if (sessionToken) return sessionToken;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setMiroToken(token: string | null, remember = false) {
  sessionToken = token;
  try {
    if (token && remember) localStorage.setItem(TOKEN_KEY, token);
    else if (!token) localStorage.removeItem(TOKEN_KEY);
  } catch { /* private window */ }
}

/**
 * Shown when pasting files copied in Miro needs a Miro connection (or the board link, when Miro's
 * clipboard didn't say). "Connect Miro" signs in once; a token pasted by hand still works as a fallback.
 * onSubmit gets a null token to use the connected account.
 */
export function MiroPasteDialog({ count, needBoard, error, onSubmit, onClose }: {
  count: number; needBoard: boolean; error?: string | null;
  onSubmit: (token: string | null, remember: boolean, link: string) => void; onClose: () => void;
}) {
  const miro = useMiroConnections();
  const [token, setToken] = useState("");
  const [link, setLink] = useState("");
  const [remember, setRemember] = useState(true);
  const oauth = miro.available === true;
  const submit = () => onSubmit(token.trim() || null, remember, link.trim());
  const ready = (!needBoard || link.trim().length > 0) && (token.trim().length > 0 || (oauth && miro.connections.length > 0));
  const tokenField = (required: boolean) => (
    <div>
      <label className="label" htmlFor="miro-paste-token">Miro access token</label>
      <input id="miro-paste-token" className="input font-mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required={required} />
      <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember in this browser so the next paste just works
      </label>
      <p className="mt-1 text-xs text-slate-500">The token stays in your browser. Schema&apos;s server uses it only to fetch the files and never saves it.</p>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form className="card max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Paste {count === 1 ? "a file" : `${count} files`} from Miro</h2>
          <button type="button" className="btn-ghost p-1" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="text-sm text-slate-600">
          Miro copies pictures, PDFs, videos and other files as a reference to the board, not the file itself.
          {oauth ? " Connect your Miro account so Schema can download them." : " Schema can download them through Miro with your access token."}
        </p>
        {needBoard && (
          <div>
            <label className="label" htmlFor="miro-paste-link">Link to the Miro board you copied from</label>
            <input id="miro-paste-link" className="input" value={link} onChange={(e) => setLink(e.target.value)} required placeholder="https://miro.com/app/board/…" autoFocus />
          </div>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {oauth && <MiroAccount miro={miro} onConnected={() => { if (!needBoard || link.trim()) submit(); }} />}
        {miro.available !== null && (oauth ? (
          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer text-slate-500">Use an access token instead</summary>
            <div className="mt-2 space-y-2">{tokenField(false)}<MiroTokenHelp /></div>
          </details>
        ) : (
          <>{tokenField(true)}<MiroTokenHelp /></>
        ))}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!ready}>Paste</button>
        </div>
      </form>
    </div>
  );
}
