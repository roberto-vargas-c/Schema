"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Undo2, Redo2, ExternalLink, ChevronLeft, ChevronRight, History, Maximize, MessageSquare, Minus, Plus, Share2, Presentation, Vote, Users, X, Sparkles, Move, ZoomIn, Mouse, MoreHorizontal, Star } from "lucide-react";
import { makeElement, type BoardElement, type ImageElement, type EmbedElement, type ConnectorElement, type VideoElement, type StickerElement, type ConnectorStyle, type DocElement, docFragment } from "@/lib/board/types";
import { embedUrlFor, looksLikeUrl } from "./embeds";
import { KeystonePicker } from "./KeystonePicker";
import { PT_IN_METERS, formatLength, metersPerPxOfPlan, type Unit } from "@/lib/board/arch";
import { unionRect, bounds as elBounds } from "./geometry";
import { ArchToolbar } from "./ArchToolbar";
import type { PluginId } from "./plugins/registry";
import { TracePanel } from "./plugins/TracePanel";
import { SitePanel } from "./plugins/SitePanel";
import { BubblePanel } from "./plugins/BubblePanel";
import { RoomsPanel } from "./plugins/RoomsPanel";
import { MaterialsPanel } from "./plugins/MaterialsPanel";
import { CritPanel } from "./plugins/CritPanel";
import { PrecedentsPanel } from "./plugins/PrecedentsPanel";
import type { PluginContext } from "./plugins/shared";
import { ScaleDialog } from "./ScaleDialog";
import { createBoard, deleteBoard, duplicateBoard, moveBoardToFolder, renameBoard, toggleStar } from "@/app/actions/workspace";
import { useBoardPrefs } from "./boardPrefs";
import { SidebarDrawer, SidebarToggleButton, useSidebarShortcut } from "@/components/AppSidebar";
import type { SidebarData } from "@/lib/sidebar";
import { LogoMark } from "@/components/Logo";
import { Avatar } from "@/components/Avatar";
import * as Y from "yjs";
import { useBoard, type Viewport, type PrivateMode } from "./useBoard";
import { TimerWidget, VotePanel, PrivateModeButton, ReactionPicker, tallyVotes, type FloatingReaction } from "./Facilitation";
import type { CanvasHandle, Tool, WheelMode } from "./Canvas";
import type { Camera } from "./geometry";
import { Toolbar } from "./Toolbar";
import { PenPalette } from "./PenPalette";
import { PEN_TIPS, type PenTip } from "@/lib/board/penTips";
import { assetIdOf, setThumbUploader, thumbFromBlob } from "./imageCache";
import { getQuality, setQuality, reduceImage, pdfSideFor, autoQualityFor, lowerQuality, QUALITIES, type Quality } from "./imageQuality";
import { CropDialog, applyCrop } from "./CropDialog";
const DocPanel = dynamic(() => import("./DocPanel").then((m) => m.DocPanel), { ssr: false });
import { decodeMiroClipboard, htmlImageSources, miroBoardId, pastedNotes, type MiroClip } from "@/lib/board/miro";
import { MiroDialog, MiroPasteDialog, getMiroToken, setMiroToken } from "./MiroImport";
import { setDarkMode, useDarkMode } from "@/components/ThemeToggle";
import { StickerPicker, STICKER_DRAG_TYPE, type StickerPick } from "./StickerPicker";
import { PropertiesBar } from "./PropertiesBar";
import { downloadsFor, runDownloads } from "./downloads";
import { groupRemapper } from "./arrange";
import { ShareDialog, type Sharing } from "./ShareDialog";
import { CommentPanel, CommentPins, useComments } from "./Comments";
import { BoardMenu, CsvDialog, DetailsDialog, ShortcutsDialog, TemplateDialog, VersionPanel, type ExportKind } from "./BoardMenu";
import { AiPanel, textItems, type AiResults } from "./AiPanel";
import { layoutClusters, summaryElement, ideaStickies, flowchartElements, mindmapElements } from "./aiLayout";

const Canvas = dynamic(() => import("./Canvas").then((m) => m.Canvas), { ssr: false });

export type BoardAppProps = {
  boardId: string;
  title: string;
  workspaceId: string | null;
  user: { id: string; name: string; color: string } | null;
  canEdit: boolean;
  canManage: boolean;
  shareToken: string | null;
  sharing: Sharing | null;
  teams: { id: string; name: string }[];
  realtimeUrl: string;
  /** The server has an Anthropic API key, so AI assist works. */
  ai?: boolean;
  /** Workspace members, for assigning task cards. */
  members: { id: string; name: string; color: string }[];
  /** The app sidebar (Home, Starred, Projects…), for workspace members. */
  sidebar?: SidebarData | null;
  /** Whether the viewer starred this board; null when they can't star it. */
  starred?: boolean | null;
  /** Workspace folders, for "Move to". */
  folders?: { id: string; name: string }[];
  /** Shown in Board › Details (workspace members only). */
  details?: { folderId: string | null; createdBy: string | null; createdAt: string; updatedAt: string } | null;
};

export function BoardApp(p: BoardAppProps) {
  const { elements: liveElements, peers, status, synced, me, api: rawApi, session, votes, doc: ydoc } = useBoard(p.boardId, p.shareToken, p.realtimeUrl);
  // Version history preview: show a saved version read-only instead of the live board.
  const [preview, setPreview] = useState<{ id: string; label: string; elements: BoardElement[] } | null>(null);
  const elements = preview?.elements ?? liveElements;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [dialog, setDialog] = useState<"csv" | "template" | "miro" | null>(null);
  const [exporting, setExporting] = useState(false);
  const canEditBoard = p.canEdit && (me?.canEdit ?? p.canEdit);
  const canEdit = canEditBoard && !preview;
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelectionState] = useState<string[]>([]);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [title, setTitle] = useState(p.title);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  useSidebarShortcut(() => { if (p.sidebar) setSidebarOpen((o) => !o); });
  const [starred, setStarred] = useState(!!p.starred);
  useEffect(() => setStarred(!!p.starred), [p.starred]);
  const [shareOpen, setShareOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState<{ x: number; y: number } | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [penColor, setPenColor] = useState("#111827");
  const [penTip, setPenTip] = useState<PenTip>("pen");
  // Each tip remembers its own width.
  const [tipWidths, setTipWidths] = useState(() =>
    Object.fromEntries(PEN_TIPS.map((t) => [t.id, t.defaultWidth])) as Record<PenTip, number>);
  const activeTip: PenTip = tool === "highlighter" ? "highlighter" : penTip;
  // Per-person view settings from the board menu, kept in this browser.
  const [prefs, setPref] = useBoardPrefs();
  const { showAuthors, wheelMode } = prefs;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Pictures (including PDF pages) on the board, for automatic upload quality. */
  const picturesRef = useRef(0);
  picturesRef.current = useMemo(() => liveElements.reduce((n, e) => n + (e.type === "image" ? 1 : 0), 0), [liveElements]);
  const cycleWheelMode = () => {
    const next: WheelMode = wheelMode === "auto" ? "zoom" : wheelMode === "zoom" ? "pan" : "auto";
    setPref("wheelMode", next);
    setToast(`Scroll wheel: ${WHEEL_LABEL[next]}`);
  };
  const [folderId, setFolderId] = useState(p.details?.folderId ?? null);
  const [infoDialog, setInfoDialog] = useState<"shortcuts" | "details" | null>(null);
  const [connectorStyle, setConnectorStyle] = useState<ConnectorStyle>("curved");
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const comments = useComments(p.boardId, p.shareToken);

  // Private mode: tag notes created while it's on so others see them face-down until it ends.
  const privateOn = !!session.privateMode?.on;
  const api = useMemo(() => (privateOn && me
    ? { ...rawApi, add: (els: BoardElement[]) => rawApi.add(els.map((e) => ({ ...e, privateOwner: me.id }))) }
    : rawApi), [rawApi, privateOn, me]);
  const hiddenIds = useMemo(() => (privateOn
    ? new Set(elements.filter((e) => e.privateOwner && e.privateOwner !== me?.id).map((e) => e.id))
    : undefined), [privateOn, elements, me?.id]);
  const setPrivateMode = (m: PrivateMode) => {
    if (!m) {
      // Reveal: clear the private flag so turning the mode on again later doesn't re-hide old notes.
      api.updateMany(elements.filter((e) => e.privateOwner).map((e) => ({ id: e.id, patch: { privateOwner: "" } })));
    }
    api.setSession("privateMode", m);
  };

  const setSelection = useCallback((ids: string[]) => { setSelectionState(ids); rawApi.setSelection(ids); }, [rawApi]);

  // ── Camera animation ──
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const anim = useRef<number | null>(null);
  const flyTo = useCallback((target: Camera, ms = 450) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    if (prefsRef.current.reduceMotion) { anim.current = null; setCamera(target); return; }
    const from = cameraRef.current;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      // Interpolate zoom in log space so it feels even.
      const scale = Math.exp(Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * e);
      setCamera({ scale, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e });
      if (k < 1) anim.current = requestAnimationFrame(step);
      else anim.current = null;
    };
    anim.current = requestAnimationFrame(step);
  }, []);
  const screenSize = () => canvasRef.current?.size() ?? { width: window.innerWidth, height: window.innerHeight };
  const cameraForViewport = useCallback((vp: Viewport): Camera => {
    const sz = canvasRef.current?.size() ?? { width: window.innerWidth, height: window.innerHeight };
    return { scale: vp.scale, x: sz.width / 2 - vp.cx * vp.scale, y: sz.height / 2 - vp.cy * vp.scale };
  }, []);
  const myViewport = (): Viewport => {
    const sz = screenSize();
    return { cx: (sz.width / 2 - camera.x) / camera.scale, cy: (sz.height / 2 - camera.y) / camera.scale, scale: camera.scale };
  };

  // Broadcast my viewport (others use it to follow me).
  useEffect(() => {
    const t = setTimeout(() => {
      const sz = canvasRef.current?.size();
      if (sz) rawApi.setPresence("viewport", { cx: (sz.width / 2 - camera.x) / camera.scale, cy: (sz.height / 2 - camera.y) / camera.scale, scale: camera.scale });
    }, 60);
    return () => clearTimeout(t);
  }, [camera, rawApi]);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Follow ──
  const [following, setFollowing] = useState<number | null>(null);
  const [optedOutOf, setOptedOutOf] = useState<number | null>(null);
  const followed = following === null ? undefined : peers.find((x) => x.clientId === following);
  useEffect(() => { if (following !== null && !followed) setFollowing(null); }, [following, followed]);
  const fvp = followed?.viewport;
  useEffect(() => { if (fvp) flyTo(cameraForViewport(fvp), 220); }, [fvp?.cx, fvp?.cy, fvp?.scale, flyTo, cameraForViewport]); // eslint-disable-line react-hooks/exhaustive-deps
  const followedPresenting = !!followed?.presenting;
  const stopFollowing = useCallback(() => {
    // Only remember the opt-out when leaving someone's presentation, so it doesn't restart.
    setFollowing((f) => { if (f !== null && followedPresenting) setOptedOutOf(f); return null; });
  }, [followedPresenting]);

  // ── Summon ("bring everyone to me") and reactions from others ──
  const seenSummon = useRef(new Map<number, number>());
  const seenReaction = useRef(new Map<number, number>());
  const [floating, setFloating] = useState<FloatingReaction[]>([]);
  const addFloating = useCallback((r: Omit<FloatingReaction, "key">) => {
    const key = Math.random().toString(36).slice(2);
    setFloating((f) => [...f.slice(-30), { ...r, key }]);
    setTimeout(() => setFloating((f) => f.filter((x) => x.key !== key)), 2600);
  }, []);
  useEffect(() => {
    for (const peer of peers) {
      const st = peer.summon?.t;
      if (st) {
        const seen = seenSummon.current.get(peer.clientId);
        seenSummon.current.set(peer.clientId, st);
        const fresh = seen === undefined ? Date.now() - st < 5000 : seen !== st;
        if (fresh && peer.summon) {
          setFollowing(null);
          flyTo(cameraForViewport(peer.summon.viewport));
          setToast(`${peer.name} brought everyone to their view`);
        }
      }
      const r = peer.reaction;
      if (r) {
        const seen = seenReaction.current.get(peer.clientId);
        seenReaction.current.set(peer.clientId, r.t);
        const fresh = seen === undefined ? Date.now() - r.t < 3000 : seen !== r.t;
        if (fresh) addFloating({ emoji: r.emoji, x: r.x, y: r.y, color: peer.color });
      }
    }
  }, [peers, flyTo, cameraForViewport, addFloating]);

  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const mv = (e: PointerEvent) => { lastPointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointermove", mv);
    return () => window.removeEventListener("pointermove", mv);
  }, []);
  const react = (emoji: string) => {
    const sz = screenSize();
    const sp = lastPointer.current && lastPointer.current.y > 70 ? lastPointer.current : { x: sz.width / 2 + (Math.random() - 0.5) * 200, y: sz.height * 0.7 };
    const w = { x: (sp.x - camera.x) / camera.scale, y: (sp.y - camera.y) / camera.scale };
    rawApi.setPresence("reaction", { emoji, ...w, t: Date.now() });
    addFloating({ emoji, ...w, color: me?.color ?? "#0f8573" });
  };
  const summonEveryone = () => {
    rawApi.setPresence("summon", { t: Date.now(), viewport: myViewport() });
    setToast("Everyone has been brought to your view");
  };

  // ── Voting ──
  const vote = session.vote;
  const [voteOpen, setVoteOpen] = useState(false);
  const lastVoteId = useRef<string | null>(null);
  useEffect(() => {
    // Open the panel for everyone when a new vote starts.
    if (vote?.id && vote.id !== lastVoteId.current) {
      if (lastVoteId.current !== null || vote.open) setVoteOpen(true);
      lastVoteId.current = vote.id;
    }
  }, [vote?.id, vote?.open]);
  const voteKey = vote && me ? `${vote.id}|${me.id}` : null;
  const myVotes = useMemo(() => (voteKey ? votes.get(voteKey) ?? [] : []), [votes, voteKey]);
  const castVote = vote?.open && canEdit && voteKey
    ? (id: string) => {
        if (myVotes.includes(id)) rawApi.setVotes(voteKey, myVotes.filter((x) => x !== id));
        else if (myVotes.length < vote.votesPerUser) rawApi.setVotes(voteKey, [...myVotes, id]);
        else setToast("You've used all your votes. Click one of your votes to take it back.");
      }
    : undefined;
  const badges = useMemo(() => {
    if (!vote) return undefined;
    const { counts } = tallyVotes(votes, vote.id);
    const showAll = !vote.open || !vote.anonymous;
    const m = new Map<string, { count: number; mine: number }>();
    const ids = new Set([...myVotes, ...(showAll ? counts.keys() : [])]);
    ids.forEach((id) => m.set(id, { count: showAll ? counts.get(id) ?? 0 : 0, mine: myVotes.includes(id) ? 1 : 0 }));
    return m;
  }, [vote, votes, myVotes]);

  // ── Presentation (frames as slides) ──
  const frames = useMemo(() => elements.filter((e) => e.type === "frame").sort((a, b) =>
    Math.abs(a.y - b.y) < Math.min(a.height, b.height) / 2 ? a.x - b.x : a.y - b.y), [elements]);
  const [slide, setSlide] = useState<number | null>(null);
  const presenting = slide !== null;
  const startPresenting = (toEveryone: boolean) => {
    if (!frames.length) { setToast("Add frames to the board first. Each frame becomes a slide."); return; }
    setSelection([]);
    setCommentsOpen(false);
    setVoteOpen(false);
    setFollowing(null);
    setSlide(0);
    if (toEveryone) rawApi.setPresence("presenting", true);
  };
  const stopPresenting = useCallback(() => { setSlide(null); rawApi.setPresence("presenting", false); }, [rawApi]);
  const current = slide !== null ? frames[Math.min(slide, frames.length - 1)] : undefined;
  useEffect(() => {
    if (!current || !canvasRef.current) return;
    flyTo(canvasRef.current.cameraFor({ x: current.x, y: current.y - 34, width: current.width, height: current.height + 34 }, 48));
  }, [current?.id, current?.x, current?.y, current?.width, current?.height, flyTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!presenting) return;
    const key = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setSlide((s) => Math.min((s ?? 0) + 1, frames.length - 1)); }
      if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setSlide((s) => Math.max((s ?? 0) - 1, 0)); }
      if (e.key === "Escape") stopPresenting();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [presenting, frames.length, stopPresenting]);
  // Auto-follow someone who presents to everyone.
  const presenter = peers.find((x) => x.presenting);
  useEffect(() => {
    if (presenter && !presenting && optedOutOf !== presenter.clientId && following !== presenter.clientId) {
      setFollowing(presenter.clientId);
      setToast(`${presenter.name} is presenting. You're following along.`);
    }
    if (!presenter && optedOutOf !== null) setOptedOutOf(null);
  }, [presenter?.clientId, presenting]); // eslint-disable-line react-hooks/exhaustive-deps
  const [presentMenu, setPresentMenu] = useState(false);

  // ── Board menu › Board ──
  const member = !!p.user && !!p.workspaceId;
  const manage = member && p.canManage;
  const fail = (what: string) => (e: unknown) => {
    // A server action that redirects rejects with Next's redirect signal: let it through.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    setError(`Couldn't ${what}. Try again.`);
  };
  const boardActions = {
    onNew: member ? () => {
      const fd = new FormData();
      fd.set("template", "blank");
      if (folderId) fd.set("folderId", folderId);
      setImporting("Creating a board…");
      createBoard(p.workspaceId!, fd).catch(fail("create a board")).finally(() => setImporting(null));
    } : undefined,
    onDuplicate: member ? () => {
      setImporting("Duplicating the board…");
      // The live board is saved a moment after each change, so give the last edits time to land.
      setTimeout(() => duplicateBoard(p.boardId).catch(fail("duplicate the board")).finally(() => setImporting(null)), 1800);
    } : undefined,
    folders: p.folders,
    folderId,
    onMove: manage && p.folders?.length ? (id: string | null) => {
      const fd = new FormData();
      fd.set("folderId", id ?? "");
      moveBoardToFolder(p.boardId, fd)
        .then(() => { setFolderId(id); setToast(id ? `Moved to ${p.folders?.find((f) => f.id === id)?.name}.` : "Moved out of its folder."); })
        .catch(fail("move the board"));
    } : undefined,
    starred,
    onToggleStar: member && p.starred != null ? () => {
      setStarred((v) => !v);
      toggleStar(p.boardId).catch((e) => { setStarred((v) => !v); fail("star the board")(e); });
    } : undefined,
    onDelete: manage ? () => {
      if (!window.confirm(`Delete “${title}” for everyone? This can't be undone.`)) return;
      deleteBoard(p.boardId).then(() => { window.location.href = `/w/${p.workspaceId}`; }).catch(fail("delete the board"));
    } : undefined,
    background: session.background,
    onBackground: canEdit ? (c: string | null) => api.setSession("background", c) : undefined,
    hasStartView: !!session.startView,
    onStartView: canEdit ? (set: boolean) => {
      api.setSession("startView", set ? myViewport() : null);
      setToast(set ? "The board now opens on this view for everyone." : "The board now opens on the whole board.");
    } : undefined,
    onHistory: canEditBoard ? () => { setHistoryOpen(true); setAiOpen(false); setCommentsOpen(false); setVoteOpen(false); } : undefined,
    onDetails: p.details ? () => setInfoDialog("details") : undefined,
  };

  // Fit the board to the screen once the first sync arrives.
  const fitted = useRef(false);
  useEffect(() => {
    if (!synced || fitted.current) return;
    // The canvas is loaded lazily, so wait until it has mounted.
    const tryFit = () => {
      if (!canvasRef.current) return void setTimeout(tryFit, 50);
      fitted.current = true;
      if (session.startView) setCamera(cameraForViewport(session.startView));
      else canvasRef.current.fitContent();
    };
    tryFit();
  }, [synced]);

  // Drop selection of elements that were deleted (possibly by someone else).
  useEffect(() => {
    const ids = new Set(elements.map((e) => e.id));
    if (selection.some((s) => !ids.has(s))) setSelection(selection.filter((s) => ids.has(s)));
  }, [elements, selection, setSelection]);

  const selected = useMemo(() => elements.filter((e) => selection.includes(e.id)), [elements, selection]);
  /** Saves the files behind the given elements (images, videos, PDFs, uploaded files). Editors only; the server checks too. */
  const downloadSelection = async (els: BoardElement[]) => {
    if (!canEdit) return;
    const items = downloadsFor(els, elements);
    if (!items.length) { setToast("Nothing to download in the selection."); return; }
    try {
      setToast(items.length > 1 ? `Downloading ${items.length} files…` : "Downloading…");
      await runDownloads(items, p.boardId, p.shareToken, setToast);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  };

  // ── Architecture: scale, units, plan import ──
  const unit: Unit = session.unit ?? "m";
  const [placingSymbol, setPlacingSymbol] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [scaleDialog, setScaleDialog] = useState<{ lengthPx: number | null; plan: ImageElement | null } | null>(null);
  const planInputRef = useRef<HTMLInputElement>(null);
  const planAt = (pt: { x: number; y: number }) => {
    for (let i = elements.length - 1; i >= 0; i--) {
      const e = elements[i];
      if (e.type === "image" && pt.x >= e.x && pt.x <= e.x + e.width && pt.y >= e.y && pt.y <= e.y + e.height) return e as ImageElement;
    }
    return null;
  };
  const selectedPlan = selected.length === 1 && selected[0].type === "image" ? (selected[0] as ImageElement) : null;
  const scaleText = (() => {
    const describe = (mpp: number) => `100 px = ${formatLength(mpp * 100, unit)}`;
    if (selectedPlan) {
      const mpp = metersPerPxOfPlan(selectedPlan);
      if (!mpp) return "This plan has no scale yet";
      const pw = selectedPlan.plan?.paperWidthPt;
      return pw ? `Plan at 1:${Math.round((mpp * selectedPlan.width) / (PT_IN_METERS * pw))}` : `Plan: ${describe(mpp)}`;
    }
    const scaled = elements.filter((e) => e.type === "image" && (e as ImageElement).scale).length;
    if (session.boardScale) return `Board: ${describe(session.boardScale.metersPerPx)}`;
    return scaled ? `${scaled} scaled plan${scaled > 1 ? "s" : ""}` : "No scale set";
  })();

  const storeThumb = useCallback((aid: string, blob: Blob) => {
    const share = p.shareToken ? `?share=${encodeURIComponent(p.shareToken)}` : "";
    return fetch(`/api/assets/${aid}/thumb${share}`, { method: "PUT", headers: { "content-type": blob.type }, body: blob });
  }, [p.shareToken]);
  // Editors store the previews their board had to make for older pictures, so the next visit loads those instead.
  useEffect(() => {
    setThumbUploader(canEdit ? storeThumb : null);
    return () => setThumbUploader(null);
  }, [canEdit, storeThumb]);
  const uploadBlob = async (blob: Blob, name: string) => {
    const type = blob.type || mediaTypeFromName(name);
    const res = await fetch(`/api/boards/${p.boardId}/assets${q}`, { method: "POST", headers: { "content-type": type }, body: blob });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed");
    const url = (await res.json()).url as string;
    // Pictures get a small preview for when the board is zoomed out.
    const aid = assetIdOf(url);
    if (aid) await thumbFromBlob(blob).then((t) => (t ? storeThumb(aid, t) : null)).catch(() => { /* the board makes one later */ });
    return url;
  };
  const importPlan = async (file: File) => {
    const center = canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 };
    const baseZ = elements.reduce((m, e) => Math.min(m, e.z), 0) - 1000;
    const name = file.name.replace(/\.[^.]+$/, "");
    try {
      const created: ImageElement[] = [];
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        setImporting("Reading PDF…");
        const { renderPdf } = await import("./pdfImport");
        const pages = await renderPdf(file, (d, t) => setImporting(`Rendering ${d}/${t}…`));
        const source = await uploadBlob(file, file.name).catch(() => undefined);
        let x = center.x - (pages[0]?.widthPt ?? 0) / 2;
        for (const pg of pages) {
          setImporting(`Uploading ${pg.page}/${pages.length}…`);
          const url = await uploadBlob(pg.blob, `${name}-p${pg.page}.png`);
          const el = makeElement("image", x, center.y - pg.heightPt / 2, {
            width: pg.widthPt, height: pg.heightPt, fill: "transparent", stroke: "transparent", locked: true, z: baseZ + pg.page,
          }) as ImageElement;
          el.src = url;
          el.plan = { name, page: pg.page, paperWidthPt: pg.widthPt, ...(source && { source }) };
          created.push(el);
          x += pg.widthPt + 120;
        }
      } else if (file.type.startsWith("image/")) {
        setImporting("Uploading…");
        const url = await uploadBlob(file, file.name);
        const img = new window.Image();
        await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; });
        const k = Math.min(1, 4000 / Math.max(img.width, img.height));
        const el = makeElement("image", center.x - (img.width * k) / 2, center.y - (img.height * k) / 2, {
          width: img.width * k, height: img.height * k, fill: "transparent", stroke: "transparent", locked: true, z: baseZ,
        }) as ImageElement;
        el.src = url;
        el.plan = { name };
        created.push(el);
      } else {
        throw new Error("Choose a PDF or an image (PNG, JPEG, WebP)");
      }
      api.add(created);
      const b = unionRect(created.map(elBounds));
      if (b && canvasRef.current) flyTo(canvasRef.current.cameraFor(b, 80));
      setToast(created.length > 1 ? `Imported ${created.length} sheets. Set the scale to start measuring.` : "Plan imported. Set the scale to start measuring.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(null);
    }
  };

  // ── Shapes & embeds ──
  const [placingShape, setPlacingShape] = useState("triangle");
  const [embedDialog, setEmbedDialog] = useState<string | null>(null);
  const [viewing, setViewing] = useState<EmbedElement | null>(null);
  const [playingVideo, setPlayingVideo] = useState<VideoElement | null>(null);
  const [cropping, setCropping] = useState<string | null>(null);
  /** Re-encodes the selected pictures at a lower quality (and makes it the default for new uploads). */
  const reduceSelectedImages = async (q: Quality) => {
    setQuality(q);
    const imgs = selected.filter((e): e is ImageElement => e.type === "image" && !(e as ImageElement).animated);
    if (q === "original" || !imgs.length) { setToast(`New uploads: ${q === "original" ? "original quality" : q + " quality"}`); return; }
    let saved = 0;
    try {
      for (const [i, im] of imgs.entries()) {
        setImporting(`Reducing ${i + 1}/${imgs.length}…`);
        const blob = await (await fetch(im.src)).blob();
        const small = await reduceImage(blob, q);
        if (small === blob) continue;
        const url = await uploadBlob(small, "image");
        api.update(im.id, { src: url } as Partial<BoardElement>);
        saved += blob.size - small.size;
      }
      setToast(saved ? `Saved ${(saved / 1024 / 1024).toFixed(1)} MB. New uploads use this quality too.` : "Already at this size or smaller. New uploads use this quality too.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reduce the images");
    } finally { setImporting(null); }
  };
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const openDocEl = openDoc ? (elements.find((e) => e.id === openDoc && e.type === "doc") as DocElement | undefined) : undefined;
  const addDoc = () => { setPlacing(makeElement("doc", -130, -160)); setTool("select"); };
  const croppingEl = cropping ? (elements.find((e) => e.id === cropping) as ImageElement | undefined) : undefined;
  const addEmbed = useCallback(async (rawUrl: string, at?: { x: number; y: number }) => {
    let url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try { new URL(url); } catch { setError("That doesn't look like a link"); return; }
    const c = at ?? canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 };
    const el = makeElement("embed", c.x - 180, c.y - 60) as EmbedElement;
    el.url = url;
    api.add([el]);
    setSelection([el.id]);
    try {
      const r = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`);
      if (r.ok) {
        const m = await r.json();
        api.update(el.id, { title: m.title ?? undefined, description: m.description ?? undefined, site: m.site ?? undefined } as Partial<BoardElement>);
      }
    } catch { /* keep the bare link */ }
  }, [api, setSelection]);

  // ── Images ──
  const q = p.shareToken ? `?share=${encodeURIComponent(p.shareToken)}` : "";
  /** Adds dropped, pasted or picked files: images (GIFs play), PDFs (one image per page) and videos. */
  const addFiles = useCallback(async (list: File[], at?: { x: number; y: number }) => {
    const files = list.filter((f) => f.size <= FILE_MAX_BYTES);
    const skipped = list.length - files.length;
    if (!files.length) { if (skipped) setError(`Files must be under ${FILE_MAX_BYTES / 1024 / 1024} MB`); return; }
    const origin = at ?? canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 };
    const created: BoardElement[] = [];
    const failed: string[] = [];
    // Upload quality: the person's choice, lowered on a board with many pictures unless they turned that off. The pictures
    // being added count too (a PDF counts its pages once they're known).
    const pictures = picturesRef.current + files.filter((f) => /^image\//.test(f.type || "") || kindOf(f) === "pdf").length;
    let autoUsed: Quality | null = null;
    const qualityFor = (extra = 0): Quality => {
      const chosen = getQuality();
      if (!prefsRef.current.autoImageQuality) return chosen;
      const q = lowerQuality(chosen, autoQualityFor(pictures + extra));
      if (q !== chosen) autoUsed = autoUsed ? lowerQuality(autoUsed, q) : q;
      return q;
    };
    // Each file's element, sized but not yet placed; laid out in rows once all are known.
    const items: BoardElement[][] = [];
    try {
      for (let [i, f] of files.entries()) {
        const tag = files.length > 1 ? ` ${i + 1}/${files.length}` : "";
        try {
          let kind = kindOf(f);
          // Pictures the board can't show directly (SVG, BMP, AVIF…) become PNGs when the browser can read them.
          if (kind === "file" && /^image\//.test(f.type || "")) {
            const png = await toPng(f);
            if (png) { f = png; kind = "image"; }
          }
          if (kind === "file") {
            setImporting(`Uploading ${f.name || "file"}${tag}…`);
            const name = f.name || "file";
            const url = await uploadBlob(f, name);
            const el = makeElement("embed", 0, 0, { width: 320, height: 96 }) as EmbedElement;
            el.url = `${url}?name=${encodeURIComponent(name)}`;
            el.title = name;
            el.site = `${fileLabel(name, f.type)} · ${formatBytes(f.size)}`;
            items.push([el]);
          } else if (kind === "pdf") {
            setImporting(`Reading PDF${tag}…`);
            const { renderPdf } = await import("./pdfImport");
            const pages = await renderPdf(f, (d, t) => setImporting(`Rendering page ${d}/${t}${tag}…`), (pages) => pdfSideFor(qualityFor(pages - 1)));
            const name = f.name.replace(/\.[^.]+$/, "");
            // The original file too, so editors can download the PDF itself and not only its pages.
            const source = await uploadBlob(f, f.name).catch(() => undefined);
            const els: BoardElement[] = [];
            let x = 0;
            for (const pg of pages) {
              setImporting(`Uploading page ${pg.page}/${pages.length}${tag}…`);
              const url = await uploadBlob(pg.blob, `${name}-p${pg.page}.png`);
              const k = Math.min(1, 900 / Math.max(pg.widthPt, pg.heightPt));
              const el = makeElement("image", x, 0, { width: pg.widthPt * k, height: pg.heightPt * k, fill: "transparent", stroke: "transparent" }) as ImageElement;
              el.src = url;
              el.plan = { name, page: pg.page, paperWidthPt: pg.widthPt, ...(source && { source }) };
              els.push(el);
              x += el.width + 40;
            }
            items.push(els);
          } else if (kind === "video") {
            setImporting(`Uploading video${tag}…`);
            const url = await uploadBlob(f, f.name);
            const size = await videoSize(url);
            const k = Math.min(1, 560 / Math.max(size.w, size.h));
            const el = makeElement("video", 0, 0, { width: size.w * k, height: size.h * k, fill: "transparent", stroke: "transparent" }) as VideoElement;
            el.src = url;
            el.name = f.name;
            el.mimeType = f.type || mediaTypeFromName(f.name);
            items.push([el]);
          } else {
            setImporting(`Uploading image${tag}…`);
            const url = await uploadBlob(await reduceImage(f, qualityFor()), f.name);
            const img = new window.Image();
            await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; });
            const k = Math.min(1, 480 / Math.max(img.width, img.height));
            const el = makeElement("image", 0, 0, { width: img.width * k, height: img.height * k, fill: "transparent", stroke: "transparent" }) as ImageElement;
            el.src = url;
            if (f.type === "image/gif") el.animated = true;
            items.push([el]);
          }
        } catch (e) {
          failed.push(`${f.name}: ${e instanceof Error ? e.message : "upload failed"}`);
        }
      }
      // Rows about as wide as they are tall, centered on the drop point.
      const gap = 32;
      const boxes = items.map((els) => unionRect(els.map(elBounds))!);
      const totalArea = boxes.reduce((a, b) => a + (b.width + gap) * (b.height + gap), 0);
      const rowMax = Math.max(Math.sqrt(totalArea) * 1.3, ...boxes.map((b) => b.width));
      const rows: { idx: number[]; w: number; h: number }[] = [];
      boxes.forEach((b, i) => {
        let row = rows[rows.length - 1];
        if (!row || row.w + b.width > rowMax) { row = { idx: [], w: 0, h: 0 }; rows.push(row); }
        row.idx.push(i); row.w += b.width + gap; row.h = Math.max(row.h, b.height);
      });
      const totalH = rows.reduce((a, r) => a + r.h + gap, -gap);
      let y = origin.y - totalH / 2;
      const z = Date.now();
      for (const row of rows) {
        let x = origin.x - (row.w - gap) / 2;
        for (const i of row.idx) {
          const b = boxes[i];
          for (const el of items[i]) created.push({ ...el, x: el.x - b.x + x, y: el.y - b.y + y, z: z + created.length });
          x += b.width + gap;
        }
        y += row.h + gap;
      }
      if (created.length) {
        api.add(created);
        setSelection(created.map((e) => e.id));
        const all = unionRect(created.map(elBounds));
        if (all && canvasRef.current && created.length > 1) {
          // Zoom out to show everything that was added, but never zoom in.
          const cam = canvasRef.current.cameraFor(all, 80);
          if (cam.scale < camera.scale) flyTo(cam);
        }
      }
      if (failed.length) setError(`Couldn't add ${failed.join("; ")}`);
      else if (skipped) setToast(`${skipped} file${skipped > 1 ? "s were" : " was"} skipped (files must be under ${FILE_MAX_BYTES / 1024 / 1024} MB)`);
      else if (autoUsed) {
        const label = QUALITIES.find((x) => x.id === autoUsed)!.label.replace(/^\w+ \((.*)\)$/, "$1");
        setToast(`This board has many pictures, so new ones were made lighter (up to ${label}). You can turn this off in the board menu, Preferences.`);
      }
    } finally {
      setImporting(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, p.boardId, q, setSelection]);
  // ── Stickers, emojis and GIFs ──
  const [stickersOpen, setStickersOpen] = useState(false);
  const [archOpen, setArchOpen] = useState(false);
  // Plug-ins share the right-hand panel spot with AI assist, comments, voting and history: opening one closes the others.
  const [plugin, setPlugin] = useState<PluginId | null>(null);
  const openPlugin = (id: PluginId) => { setPlugin(id); setAiOpen(false); setHistoryOpen(false); setCommentsOpen(false); setVoteOpen(false); };
  useEffect(() => { if (aiOpen || historyOpen || commentsOpen || voteOpen) setPlugin(null); }, [aiOpen, historyOpen, commentsOpen, voteOpen]);
  const pluginCtx: PluginContext | null = plugin ? {
    elements, selected, api, select: setSelection, toast: setToast, upload: uploadBlob, unit, boardTitle: title, boardId: p.boardId,
    exportImage: async (rect, pixelsPerUnit, type = "image/jpeg") => {
      // without the selection outline in the picture
      const keep = selected.map((e) => e.id);
      setSelection([]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        const img = canvasRef.current?.exportImage({ rect, pixelsPerUnit, type });
        return img ? await (await fetch(img.url)).blob() : null;
      } finally { setSelection(keep); }
    },
    boardScale: session.boardScale ?? null, user: p.user ? { id: p.user.id, name: p.user.name } : null,
    center: () => canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 },
    focus: (els) => { const b = unionRect(els.map(elBounds)); if (b && canvasRef.current) flyTo(canvasRef.current.cameraFor(b, 120)); },
  } : null;
  const [moreOpen, setMoreOpen] = useState(false);
  const isPhone = useIsPhone();
  const dark = useDarkMode();
  // Tapping anywhere outside the header closes the phone "More" menu.
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest("header, .card")) setMoreOpen(false); };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [moreOpen]);
  const gifInputRef = useRef<HTMLInputElement>(null);
  const boardGifs = useMemo(() => Array.from(new Set(elements.filter((e) => e.type === "image" && (e as ImageElement).animated).map((e) => (e as ImageElement).src))), [elements]);
  /** Element to add for a sticker, emoji or GIF, centered on (0, 0). */
  const stickerTemplate = useCallback(async (pk: StickerPick): Promise<BoardElement> => {
    if (pk.kind === "gif") {
      const img = new window.Image();
      await new Promise((r) => { img.onload = r; img.onerror = r; img.src = pk.id; });
      const k = Math.min(1, 320 / Math.max(img.width || 320, img.height || 320));
      const w = (img.width || 320) * k, h = (img.height || 320) * k;
      const el = makeElement("image", -w / 2, -h / 2, { width: w, height: h, fill: "transparent", stroke: "transparent" });
      return Object.assign(el, { src: pk.id, animated: true });
    }
    const size = pk.kind === "emoji" ? 120 : 180;
    const h = pk.kind === "emoji" ? size : size * (228 / 224);
    const el = makeElement("sticker", -size / 2, -h / 2, { width: size, height: h, fill: "transparent", stroke: "transparent" });
    return Object.assign(el as StickerElement, pk.kind === "emoji" ? { emoji: pk.id } : { sticker: pk.id });
  }, []);
  /** Places a copy of a template element centered at a board point. */
  const placeTemplate = useCallback((t: BoardElement, at: { x: number; y: number }) => {
    const el = { ...t, id: makeElement(t.type, 0, 0).id, x: at.x - t.width / 2, y: at.y - t.height / 2, z: Date.now() } as BoardElement;
    api.add([el]);
    setSelection([el.id]);
    return el;
  }, [api, setSelection]);
  const addSticker = useCallback(async (pk: StickerPick, at?: { x: number; y: number }) => {
    const c = at ?? canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 };
    placeTemplate(await stickerTemplate(pk), c);
  }, [placeTemplate, stickerTemplate]);
  // Something picked from a menu follows the pointer as a ghost until a click puts it down (Esc cancels).
  const [placing, setPlacing] = useState<BoardElement | null>(null);
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => { setCoarsePointer(window.matchMedia?.("(pointer: coarse)").matches ?? false); }, []);
  // Safari on iPhone ignores user-scalable=no, so stop page pinch-zoom here (the canvas handles its own pinch first).
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    return () => document.removeEventListener("gesturestart", stop);
  }, []);
  const onPlace = (at: { x: number; y: number }) => {
    if (!placing) return;
    const el = placeTemplate(placing, at);
    if (el.type === "doc") setOpenDoc(el.id);
    setPlacing(null);
  };
  const addImageFile = useCallback((f: File, at?: { x: number; y: number }) => addFiles([f], at), [addFiles]);

  // ── Paste ──
  // Files first (screenshots, files copied in the file manager, pictures copied in a browser), then files
  // copied in Miro (its clipboard only names them, so they're fetched through Miro's API), then pictures in
  // copied HTML, then a link, then text as sticky notes.
  const [miroPaste, setMiroPaste] = useState<{ clip: MiroClip; at?: { x: number; y: number }; error?: string } | null>(null);
  const fetchMiroFiles = useCallback(async (clip: MiroClip, token: string | null, at?: { x: number; y: number }) => {
    const files: File[] = [];
    const failed: string[] = [];
    let denied: string | null = null;
    for (const [i, it] of clip.files.entries()) {
      setImporting(`Getting ${it.name || "file"} from Miro${clip.files.length > 1 ? ` ${i + 1}/${clip.files.length}` : ""}…`);
      try {
        const res = await fetch(`/api/boards/${p.boardId}/import/miro/file${q}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ board: clip.boardId, item: it.itemId, name: it.name, token: token ?? undefined }),
        });
        if (res.status === 401 || res.status === 403) {
          const j = await res.json().catch(() => ({}));
          // Not connected yet: the dialog explains, no need for an error line.
          denied = res.status === 401 && !token && j.needsConnect ? "" : j.error ?? "Miro didn't allow this. Connect Miro again";
          break;
        }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `failed (${res.status})`);
        if ((res.headers.get("content-type") ?? "").startsWith("application/json")) {
          const j = await res.json();
          if (j.link) addEmbed(j.link);
          continue;
        }
        const blob = await res.blob();
        files.push(new File([blob], withExtension(decodeURIComponent(res.headers.get("x-file-name") ?? it.name ?? "file"), blob.type), { type: blob.type }));
      } catch (e) {
        failed.push(`${it.name || it.kind}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setImporting(null);
    if (denied !== null) { if (token) setMiroToken(null); setMiroPaste({ clip, at, error: denied || undefined }); return; }
    if (files.length) await addFiles(files, at);
    if (failed.length) setError(`Couldn't paste from Miro: ${failed.join("; ")}`);
  }, [addFiles, addEmbed, p.boardId, q]);
  const pasteFromMiro = useCallback((clip: MiroClip, at?: { x: number; y: number }) => {
    // With a connected Miro account (or a remembered token) this just works; otherwise the server says so
    // and the dialog offers "Connect Miro".
    if (clip.boardId) fetchMiroFiles(clip, getMiroToken(), at);
    else setMiroPaste({ clip, at });
  }, [fetchMiroFiles]);

  /** Adds sticky notes in a grid at the view's center; returns a point to the right of them. */
  const addNotes = useCallback((notes: string[]) => {
    const c = canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 };
    const cols = Math.ceil(Math.sqrt(notes.length)), size = 200, gap = 24;
    const rows = Math.ceil(notes.length / cols);
    const z = Date.now();
    const els = notes.map((t, i) => makeElement("sticky", c.x - (cols * (size + gap)) / 2 + (i % cols) * (size + gap), c.y - (rows * (size + gap)) / 2 + Math.floor(i / cols) * (size + gap), {
      width: size, height: size, text: t, z: z + i, fontSize: t.length > 120 ? 13 : t.length > 60 ? 15 : 18,
    }));
    api.add(els);
    setSelection(els.map((x) => x.id));
    if (els.length > 1) setToast(`Pasted ${els.length} sticky notes`);
    return { x: c.x + (cols * (size + gap)) / 2 + 300, y: c.y };
  }, [api, setSelection]);

  /** Downloads pictures named in pasted HTML (data: links are read in the browser). */
  const pasteImageLinks = useCallback(async (srcs: string[], at?: { x: number; y: number }) => {
    const files: File[] = [];
    for (const [i, src] of srcs.entries()) {
      setImporting(`Getting picture${srcs.length > 1 ? ` ${i + 1}/${srcs.length}` : ""}…`);
      try {
        const res = src.startsWith("data:") ? await fetch(src) : await fetch(`/api/boards/${p.boardId}/fetch${q ? `${q}&` : "?"}url=${encodeURIComponent(src)}`);
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob.type.startsWith("image/")) continue;
        const name = decodeURIComponent(res.headers.get("x-file-name") ?? "") || "pasted";
        files.push(new File([blob], withExtension(name, blob.type), { type: blob.type }));
      } catch { /* skip that one */ }
    }
    setImporting(null);
    if (files.length) await addFiles(files, at);
    else setError("Couldn't download the pasted picture. Try saving it and dropping the file on the board");
  }, [addFiles, p.boardId, q]);

  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (e: ClipboardEvent) => {
      const a = document.activeElement;
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a as HTMLElement | null)?.isContentEditable) return;
      const dt = e.clipboardData;
      if (e.defaultPrevented || !dt) return;
      let files = Array.from(dt.files ?? []);
      if (!files.length) files = Array.from(dt.items ?? []).filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter((f): f is File => !!f);
      if (files.length) { e.preventDefault(); addFiles(files); return; }
      const html = dt.getData("text/html") ?? "";
      const text = dt.getData("text/plain") ?? "";
      const clip = decodeMiroClipboard(html);
      if (clip?.files.length) {
        e.preventDefault();
        // Notes and text copied along with the files still come over as sticky notes.
        let at: { x: number; y: number } | undefined;
        if (clip.widgetTypes.some((t) => ["sticker", "text", "shape", "card"].includes(t))) {
          const notes = pastedNotes(text, html);
          if (notes.length) at = addNotes(notes);
        }
        pasteFromMiro(clip, at);
        return;
      }
      if (looksLikeUrl(text)) { e.preventDefault(); addEmbed(text); return; }
      const imgs = clip ? [] : htmlImageSources(html);
      const notes = pastedNotes(text, html);
      if (!imgs.length && !notes.length) return;
      e.preventDefault();
      const at = notes.length ? addNotes(notes) : undefined;
      if (imgs.length) pasteImageLinks(imgs, at);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [canEdit, addFiles, addEmbed, addNotes, pasteFromMiro, pasteImageLinks]);

  const duplicateSelected = () => {
    const src = selected.filter((s) => s.type !== "connector");
    const regroup = groupRemapper();
    const copies: BoardElement[] = src.map((s) => ({ ...s, id: makeElement(s.type, 0, 0).id, groupId: regroup(s.groupId), x: s.x + 24, y: s.y + 24, z: Date.now() + Math.random() }));
    // Documents keep their content outside the element, so copy it too.
    ydoc.transact(() => src.forEach((s, i) => {
      if (s.type !== "doc") return;
      copyXml(ydoc.getXmlFragment(docFragment(s.id)), ydoc.getXmlFragment(docFragment(copies[i].id)));
    }));
    api.add(copies);
    setSelection(copies.map((c) => c.id));
  };

  // ── AI assist: apply results to the board ──
  const selectionBox = () => (selected.length ? unionRect(selected.map(elBounds)) : null);
  const besideSelection = () => {
    const b = selectionBox();
    return b ? { x: b.x + b.width + 80, y: b.y } : canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 };
  };
  /** Shift a group of new elements right until it no longer covers anything already on the board. */
  const placeClear = (els: BoardElement[]) => {
    const box = unionRect(els.filter((e) => e.type !== "connector").map(elBounds));
    if (!box) return els;
    const others = elements.filter((e) => e.type !== "connector").map(elBounds);
    const gap = 60;
    let dx = 0;
    for (let i = 0; i < 100; i++) {
      const r = { ...box, x: box.x + dx };
      const hits = others.filter((o) => o.x < r.x + r.width + gap && o.x + o.width + gap > r.x && o.y < r.y + r.height + gap && o.y + o.height + gap > r.y);
      if (!hits.length) break;
      dx = Math.max(...hits.map((o) => o.x + o.width)) + gap * 2 - box.x;
    }
    if (!dx) return els;
    return els.map((e) => (e.type === "connector"
      ? { ...e, from: { ...(e as ConnectorElement).from, x: (e as ConnectorElement).from.x + dx }, to: { ...(e as ConnectorElement).to, x: (e as ConnectorElement).to.x + dx } }
      : { ...e, x: e.x + dx })) as BoardElement[];
  };
  /** Bring AI results into view, keeping clear of the AI panel on the right. */
  const revealEls = (els: BoardElement[]) => {
    const b = unionRect(els.filter((e) => e.type !== "connector").map(elBounds));
    if (b) requestAnimationFrame(() => canvasRef.current?.reveal(b, aiOpen ? 344 : 0));
  };
  const clusterByTheme = async () => {
    const items = textItems(selected);
    setImporting("Clustering by theme…");
    try {
      const res = await fetch(`/api/boards/${p.boardId}/ai${q}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cluster", items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't cluster the selection");
      aiCluster(data as AiResults["cluster"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cluster the selection");
    } finally { setImporting(null); }
  };
  const aiCluster = (r: AiResults["cluster"]) => {
    const b = selectionBox();
    const byId = new Map(elements.map((e) => [e.id, e]));
    const { updates, frames } = layoutClusters(r.clusters, byId, b ? { x: b.x, y: b.y } : { x: 0, y: 0 });
    api.add(frames);
    api.updateMany(updates);
    setSelection(updates.map((u) => u.id));
    revealEls(frames);
    setToast(`Grouped into ${frames.length} themes. Undo puts the notes back.`);
  };
  const aiSummary = (r: AiResults["summarize"]) => {
    const [el] = placeClear([summaryElement(r, besideSelection())]);
    api.add([el]);
    setSelection([el.id]);
    revealEls([...selected, el]);
    setToast("Added a summary next to the selection.");
  };
  const aiIdeas = (r: AiResults["ideas"]) => {
    const els = placeClear(ideaStickies(r.ideas, besideSelection()));
    api.add(els);
    setSelection(els.map((e) => e.id));
    revealEls([...selected, ...els]);
    setToast(`Added ${els.length} idea notes.`);
  };
  const aiDiagram = (r: AiResults["diagram"], kind: "flowchart" | "mindmap") => {
    const els = kind === "flowchart" ? flowchartElements(r.nodes, r.edges, { x: 0, y: 0 }) : mindmapElements(r.nodes, { x: 0, y: 0 });
    const shapes = els.filter((e) => e.type !== "connector");
    const b = unionRect(shapes.map(elBounds));
    if (!b) { setToast("The AI didn't return a diagram. Try describing it differently."); return; }
    const c = canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 };
    const dx = c.x - (b.x + b.width / 2), dy = c.y - (b.y + b.height / 2);
    const moved = placeClear(els.map((e) => (e.type === "connector"
      ? { ...e, from: { ...(e as ConnectorElement).from, x: (e as ConnectorElement).from.x + dx, y: (e as ConnectorElement).from.y + dy },
          to: { ...(e as ConnectorElement).to, x: (e as ConnectorElement).to.x + dx, y: (e as ConnectorElement).to.y + dy } }
      : { ...e, x: e.x + dx, y: e.y + dy })) as BoardElement[]);
    api.add(moved);
    setSelection(moved.filter((e) => e.type !== "connector").map((e) => e.id));
    revealEls(moved);
    setToast(`Added a ${kind === "flowchart" ? "flowchart" : "mind map"} with ${shapes.filter((e) => e.type !== "text").length} boxes.`);
  };

  const exportBoard = async (kind: ExportKind) => {
    const c = canvasRef.current;
    if (!c || exporting) return;
    const sel = selected.length ? unionRect(selected.map(elBounds)) : null;
    const selRect = sel ? { x: sel.x - 24, y: sel.y - 24, width: sel.width + 48, height: sel.height + 48 } : undefined;
    const name = (title || "board").replace(/[\\/:*?"<>|]+/g, "-");
    setExporting(true);
    setToast(kind.startsWith("pdf") ? "Preparing the PDF…" : "Preparing the image…");
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the toast paint before the heavy render
      const rects = kind === "pdf-frames" ? frames.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height })) : [selRect];
      // Off-screen items aren't normally drawn: draw (and load) everything being exported first.
      await c.prepareExport(rects);
      if (kind === "png" || kind === "png-hi") {
        const img = c.exportImage({ rect: selRect, pixelsPerUnit: kind === "png-hi" ? 4 : 2 });
        if (!img) { setToast("The board is empty."); return; }
        const a = document.createElement("a");
        a.href = img.url;
        a.download = `${name}.png`;
        a.click();
        setToast(null);
        return;
      }
      // PDF pages are sized in points at 1 board unit = 1 pt, so a plan imported from a PDF keeps its paper size and scale.
      const { jsPDF } = await import("jspdf");
      let pdf: InstanceType<typeof jsPDF> | null = null;
      for (const rect of rects) {
        const img = c.exportImage({ rect, pixelsPerUnit: 3 });
        if (!img) continue;
        const f = Math.min(1, 14400 / Math.max(img.rect.width, img.rect.height));
        const w = img.rect.width * f, h = img.rect.height * f;
        const orientation = w > h ? "landscape" : "portrait";
        if (!pdf) pdf = new jsPDF({ unit: "pt", format: [w, h], orientation, compress: true });
        else pdf.addPage([w, h], orientation);
        pdf.addImage(img.url, "PNG", 0, 0, w, h, undefined, "FAST");
      }
      if (!pdf) { setToast("The board is empty."); return; }
      pdf.save(`${name}.pdf`);
      setToast(null);
    } catch (e) {
      setToast(e instanceof Error ? `Export failed: ${e.message}` : "Export failed");
    } finally {
      c.endExport();
      setExporting(false);
    }
  };

  if (status === "denied") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="card max-w-sm p-6 text-center">
          <p>You don't have access to this board.</p>
          <Link href="/w" className="btn-primary mt-4">Go to my boards</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="board-root fixed inset-0 select-none"
      onDragOver={(e) => { if (canEdit) e.preventDefault(); }}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        const sticker = e.dataTransfer.getData(STICKER_DRAG_TYPE);
        if (sticker) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
          try { addSticker(JSON.parse(sticker), { x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale }); } catch { /* not ours */ }
        } else if (files.length) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
          addFiles(files, { x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale });
        } else {
          const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
          if (looksLikeUrl(url)) addEmbed(url);
        }
      }}>
      <Canvas
        ref={canvasRef}
        elements={elements}
        api={api}
        peers={peers}
        canEdit={canEdit && !presenting}
        onManualCamera={() => { if (anim.current) { cancelAnimationFrame(anim.current); anim.current = null; } stopFollowing(); }}
        onVote={castVote}
        badges={badges}
        hiddenIds={hiddenIds}
        presenting={presenting}
        tool={tool}
        setTool={setTool}
        selection={selection}
        setSelection={setSelection}
        camera={camera}
        setCamera={setCamera}
        penColor={penColor}
        penWidth={tipWidths[activeTip]}
        penTip={penTip}
        connectorStyle={connectorStyle}
        wheelMode={wheelMode}
        onOpenVideo={(el) => setPlayingVideo(el)}
        onOpenDoc={(id) => setOpenDoc(id)}
        placing={placing}
        showAuthors={showAuthors}
        grid={prefs.grid}
        background={session.background}
        showCursors={prefs.showCursors}
        showConnectors={prefs.showConnectors}
        showDimensions={prefs.showDimensions}
        onPlace={onPlace}
        onCancelPlace={() => setPlacing(null)}
        onCopyDoc={(from, to) => ydoc.transact(() => copyXml(ydoc.getXmlFragment(docFragment(from)), ydoc.getXmlFragment(docFragment(to))))}
        boardScale={session.boardScale}
        unit={unit}
        placingSymbol={placingSymbol}
        placingShape={placingShape}
        onOpenEmbed={(el) => {
          if (embedUrlFor(el.url)) setViewing(el);
          // Uploaded files only open as downloads, which are for editors.
          else if (el.url.startsWith("/api/assets/")) {
            if (canEdit) downloadSelection([el]); else setToast("Only editors can download files from this board.");
          } else window.open(el.url, "_blank", "noopener,noreferrer");
        }}
        onCalibrate={(l) => setScaleDialog({ lengthPx: Math.hypot(l.x2 - l.x1, l.y2 - l.y1), plan: planAt({ x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 }) })}
        onComment={(pt) => { setCommentDraft(pt); setCommentsOpen(true); setActiveComment(null); }}
        overlay={<>
          {!presenting && prefs.showComments && <CommentPins comments={comments.comments} camera={camera} activeId={activeComment} draft={commentDraft} showResolved={showResolved}
            onOpen={(id) => { setActiveComment(id); setCommentsOpen(true); }} />}
          {!prefs.reduceMotion && floating.map((r) => (
            <div key={r.key} className="reaction-float pointer-events-none absolute z-[6] text-4xl"
              style={{ left: r.x * camera.scale + camera.x - 20, top: r.y * camera.scale + camera.y - 20 }}>{r.emoji}</div>
          ))}
        </>}
      />

      {followed && (
        <div className="pointer-events-none absolute inset-0 z-[35] border-4" style={{ borderColor: followed.color }}>
          <div className="pointer-events-auto absolute left-1/2 top-0 flex -translate-x-1/2 items-center gap-2 rounded-b-lg px-3 py-1 text-sm font-medium text-white"
            style={{ background: followed.color }}>
            Following {followed.name}
            <button className="rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30" onClick={stopFollowing}>Stop</button>
          </div>
        </div>
      )}

      {presenting && current && (
        <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-slate-900/90 px-3 py-2 text-sm text-white shadow-xl">
          <button className="rounded p-1 hover:bg-white/10 disabled:opacity-30" disabled={slide === 0} onClick={() => setSlide((s) => Math.max(0, (s ?? 0) - 1))} title="Previous (←)">
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-[10ch] text-center tabular-nums">{(slide ?? 0) + 1} / {frames.length} · {current.text || "Frame"}</span>
          <button className="rounded p-1 hover:bg-white/10 disabled:opacity-30" disabled={slide === frames.length - 1} onClick={() => setSlide((s) => Math.min(frames.length - 1, (s ?? 0) + 1))} title="Next (→)">
            <ChevronRight size={18} />
          </button>
          <button className="ml-2 flex items-center gap-1 rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={stopPresenting}><X size={14} /> Exit</button>
        </div>
      )}

      {privateOn && !presenting && (
        <div className="absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow">
          Private mode is on: new notes stay hidden from others until it&apos;s turned off
        </div>
      )}
      {toast && (
        <div className="pointer-events-none absolute bottom-36 left-1/2 z-40 max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-center text-sm text-white shadow-lg sm:bottom-20">{toast}</div>
      )}

      {p.sidebar && <SidebarDrawer data={p.sidebar} open={sidebarOpen && !presenting} onClose={closeSidebar} currentBoardId={p.boardId} />}
      {!presenting && <>
      {/* Top bar */}
      <header className="absolute left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl sm:flex-none border border-slate-200 bg-white px-2 py-1.5 shadow-lg">
          {p.sidebar ? <SidebarToggleButton onClick={() => setSidebarOpen(true)} /> : (
            <Link href={p.workspaceId ? `/w/${p.workspaceId}` : "/w"} className="btn-ghost p-1.5" title="Back to boards">
              <ChevronLeft size={18} /><LogoMark size={22} />
            </Link>
          )}
          <input
            className="w-0 min-w-0 flex-1 rounded-md bg-transparent px-1 py-1 text-sm font-medium sm:w-auto sm:max-w-[40vw] sm:flex-none sm:px-2 outline-none hover:bg-slate-50 focus:bg-slate-50"
            value={title}
            disabled={!canEdit || !p.user}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title !== p.title) renameBoard(p.boardId, title).catch(() => setTitle(p.title)); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          {p.starred != null && (
            <button type="button" className={`btn-ghost shrink-0 p-1.5 ${starred ? "text-amber-500 hover:text-amber-600" : "text-slate-400"}`}
              title={starred ? "Unstar this board" : "Star this board"} aria-label={starred ? "Unstar this board" : "Star this board"} aria-pressed={starred}
              onClick={() => { setStarred((v) => !v); toggleStar(p.boardId).catch(() => setStarred((v) => !v)); }}>
              <Star size={16} fill={starred ? "currentColor" : "none"} />
            </button>
          )}
          <span className={`mx-1 h-2 w-2 shrink-0 rounded-full ${status === "connected" ? "bg-emerald-500" : "bg-amber-400"}`}
            title={status === "connected" ? "Live" : "Reconnecting…"} />
          {!canEdit && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">View only</span>}
        </div>
        <div className="relative ml-auto flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-1.5 py-1.5 shadow-lg sm:gap-2 sm:px-2">
          {!isPhone && <TimerWidget timer={session.timer} canEdit={canEdit} me={me?.name ?? ""} onChange={(t) => api.setSession("timer", t)} />}
          <div className="flex -space-x-2">
            {me && <Avatar name={`${me.name} (you)`} color={me.color} src={me.avatar} size={28} />}
            {dedupePeers(peers).slice(0, isPhone ? 2 : 5).map((x) => (
              <button key={x.clientId} title={following === x.clientId ? `Stop following ${x.name}` : `Follow ${x.name}`}
                className={`rounded-full ${following === x.clientId ? "ring-2 ring-offset-1" : ""}`} style={{ ["--tw-ring-color" as string]: x.color }}
                onClick={() => (following === x.clientId ? stopFollowing() : setFollowing(x.clientId))}>
                <Avatar name={x.name} color={x.color} src={x.avatar} size={28} />
              </button>
            ))}
            {dedupePeers(peers).length > (isPhone ? 2 : 5) && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs ring-2 ring-white">+{dedupePeers(peers).length - (isPhone ? 2 : 5)}</span>}
          </div>
          <button className={`btn-ghost p-1.5 sm:hidden ${moreOpen ? "bg-slate-100" : ""}`} title="More" onClick={() => setMoreOpen((o) => !o)}><MoreHorizontal size={18} /></button>
          {/* On phones these live in the "More" menu; on wider screens they sit in the bar. */}
          <div className={`${moreOpen ? "card absolute right-0 top-12 flex w-[min(19rem,calc(100vw-24px))] flex-wrap items-center gap-1 p-1.5" : "hidden"} sm:static sm:flex sm:w-auto sm:flex-nowrap sm:gap-2 sm:rounded-none sm:border-0 sm:p-0 sm:shadow-none`}
            onClick={(e) => { if (isPhone && (e.target as HTMLElement).closest("button[title]") && !(e.target as HTMLElement).closest("[data-keep-open]")) setTimeout(() => setMoreOpen(false), 0); }}>
          {isPhone && <div data-keep-open className="contents"><TimerWidget timer={session.timer} canEdit={canEdit} me={me?.name ?? ""} onChange={(t) => api.setSession("timer", t)} /></div>}
          {canEdit && peers.length > 0 && (
            <button className="btn-ghost p-1.5" title="Bring everyone to my view" onClick={summonEveryone}><Users size={18} /></button>
          )}
          <div className="hidden h-6 w-px bg-slate-200 sm:block" />
          <div data-keep-open className="contents"><ReactionPicker onReact={react} /></div>
          <PrivateModeButton mode={session.privateMode} canEdit={canEdit} me={me?.id ?? ""} onChange={setPrivateMode} />
          <button className={`btn-ghost p-1.5 ${voteOpen || vote?.open ? "bg-slate-100" : ""} ${vote?.open ? "text-brand-700" : ""}`} title="Voting"
            onClick={() => { setVoteOpen((o) => !o); setCommentsOpen(false); setHistoryOpen(false); setAiOpen(false); }}>
            <Vote size={18} />
          </button>
          <div className="relative" data-keep-open>
            <button className="btn-ghost p-1.5" title="Present frames as slides" onClick={() => setPresentMenu((o) => !o)}><Presentation size={18} /></button>
            {presentMenu && (
              <div className="card fixed left-3 right-3 top-40 z-40 sm:absolute sm:left-auto sm:right-0 sm:top-10 sm:z-30 sm:w-56 p-1" onMouseLeave={() => setPresentMenu(false)}>
                <button className="btn-ghost w-full justify-start" onClick={() => { setPresentMenu(false); startPresenting(false); }}>Present on my screen</button>
                {canEdit && <button className="btn-ghost w-full justify-start" onClick={() => { setPresentMenu(false); startPresenting(true); }}>Present to everyone</button>}
                <p className="px-3 pb-1 text-xs text-slate-500">{frames.length} frame{frames.length === 1 ? "" : "s"}, shown in reading order.</p>
              </div>
            )}
          </div>
          <button className={`btn-ghost p-1.5 ${commentsOpen ? "bg-slate-100" : ""}`} title="Comments" onClick={() => { setCommentsOpen((o) => !o); setVoteOpen(false); setHistoryOpen(false); setAiOpen(false); }}>
            <MessageSquare size={18} />
          </button>
          {canEdit && (
            <button className={`btn-ghost p-1.5 ${aiOpen ? "bg-violet-50 text-violet-700" : "text-violet-600"}`} title="AI assist: group, summarize, ideas, diagrams"
              onClick={() => { setAiOpen((o) => !o); setHistoryOpen(false); setCommentsOpen(false); setVoteOpen(false); }}>
              <Sparkles size={18} />
            </button>
          )}
          {canEditBoard && (
            <button className={`btn-ghost p-1.5 ${historyOpen ? "bg-slate-100" : ""}`} title="Version history"
              onClick={() => { setHistoryOpen((o) => !o); setAiOpen(false); setCommentsOpen(false); setVoteOpen(false); }}>
              <History size={18} />
            </button>
          )}
          <div data-keep-open className="contents"><BoardMenu prefs={prefs} setPref={setPref} board={boardActions}
            onExport={exportBoard} onImportCsv={() => setDialog("csv")} onImportMiro={p.user ? () => setDialog("miro") : undefined} onSaveTemplate={() => setDialog("template")}
            onShortcuts={() => setInfoDialog("shortcuts")} dark={dark} onToggleDark={() => setDarkMode(!dark)}
            onUndo={api.undo} onRedo={api.redo} onSelectAll={() => setSelection(elements.map((e) => e.id))}
            onDuplicate={duplicateSelected} onDelete={() => { api.remove(selection); setSelection([]); }}
            canEdit={canEdit} canTemplate={canEditBoard && !!p.user && !!p.workspaceId} frameCount={frames.length} hasSelection={selected.length > 0} /></div>
          </div>
          {p.sharing && <button className="btn-primary px-2.5 py-1.5 sm:px-4" title="Share" onClick={() => setShareOpen(true)}><Share2 size={16} /> <span className="hidden sm:inline">Share</span></button>}
        </div>
      </header>

      <Toolbar tool={tool} setTool={setTool} canEdit={canEdit} canComment={!!p.user} onImage={() => fileRef.current?.click()}
        onEmbed={() => setEmbedDialog("")} placingShape={placingShape} setPlacingShape={setPlacingShape}
        stickersOpen={stickersOpen} onStickers={() => { setStickersOpen((o) => !o); setArchOpen(false); }} onDoc={addDoc}
        archOpen={archOpen} onArch={canEdit ? () => { setArchOpen((o) => !o); setStickersOpen(false); } : undefined} />
      {canEdit && stickersOpen && (
        <StickerPicker gifs={boardGifs} onPick={async (pk) => { setPlacing(await stickerTemplate(pk)); setTool("select"); if (isPhone) setStickersOpen(false); }} onUploadGif={() => gifInputRef.current?.click()} onClose={() => setStickersOpen(false)} />
      )}
      {placing && (
        <div className="pointer-events-none absolute left-1/2 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] z-20 -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-200 bg-white py-1 pl-3 pr-1 text-sm text-slate-700 shadow-lg">
            <span>{coarsePointer ? "Drag on the board to position, lift to place" : "Click to place · Esc to cancel"}</span>
            <button className="btn-ghost rounded-full p-1" title="Cancel" onClick={() => setPlacing(null)}><X size={14} /></button>
          </div>
        </div>
      )}
      <input ref={gifInputRef} type="file" multiple accept="image/gif" hidden
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) addFiles(fs); e.target.value = ""; }} />
      <input ref={fileRef} type="file" multiple hidden
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) addFiles(fs); e.target.value = ""; }} />

      {canEdit && (
        <ArchToolbar tool={tool} setTool={setTool} onImportPlan={() => planInputRef.current?.click()} importing={importing}
          placingSymbol={placingSymbol} setPlacingSymbol={setPlacingSymbol}
          unit={unit} setUnit={(u) => api.setSession("unit", u)} scaleText={scaleText} mobileOpen={archOpen}
          plugin={plugin} onPlugin={openPlugin} />
      )}
      <input ref={planInputRef} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importPlan(f); e.target.value = ""; }} />

      {(tool === "pen" || tool === "highlighter") && (
        <PenPalette tip={activeTip} color={penColor} setColor={setPenColor}
          // The highlighter keeps its own tool (and shortcut); picking it here switches to that tool.
          setTip={(t) => { if (t === "highlighter") setTool("highlighter"); else { setPenTip(t); setTool("pen"); } }}
          width={tipWidths[activeTip]} setWidth={(w) => setTipWidths((m) => ({ ...m, [activeTip]: w }))} />
      )}
      {tool === "connector" && (
        <div className="absolute left-3 top-[4.25rem] z-10 flex gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg sm:left-16 sm:top-1/2 sm:ml-2 sm:-translate-y-1/2 sm:flex-col">
          {CONNECTOR_STYLES.map(([id, label, d]) => (
            <button key={id} title={label} onClick={() => {
              setConnectorStyle(id);
              const conns = selected.filter((e) => e.type === "connector");
              if (conns.length) api.updateMany(conns.map((c) => ({ id: c.id, patch: { style: id } as Partial<BoardElement> })));
            }}
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${connectorStyle === id ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
              <svg width="22" height="22" viewBox="0 0 22 22"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ))}
        </div>
      )}

      {canEdit && !(isPhone && tool !== "select") && <PropertiesBar selected={selected} all={elements} api={api} onDuplicate={duplicateSelected}
        onSetScale={selectedPlan ? () => setScaleDialog({ lengthPx: null, plan: selectedPlan }) : undefined}
        members={p.members}
        onCrop={(el) => setCropping(el.id)}
        onQuality={reduceSelectedImages}
        onAiCluster={p.ai ? clusterByTheme : undefined}
        onSelect={setSelection}
        onDownload={downloadsFor(selected, elements).length ? () => downloadSelection(selected) : undefined}
        onDelete={() => { api.remove(selection); setSelection([]); }} />}

      {/* Zoom */}
      <div className={`absolute bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3.75rem)] left-[max(0.75rem,env(safe-area-inset-left))] z-10 flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-lg sm:bottom-3 ${archOpen || stickersOpen ? "max-sm:hidden" : ""}`}>
        <button className="btn-ghost p-1.5" title="Zoom out" onClick={() => canvasRef.current?.zoomBy(1 / 1.2)}><Minus size={16} /></button>
        <button className="w-14 text-center text-xs tabular-nums" title="Reset to 100%" onClick={() => canvasRef.current?.zoomTo(1)}>
          {Math.round(camera.scale * 100)}%
        </button>
        <button className="btn-ghost p-1.5" title="Zoom in" onClick={() => canvasRef.current?.zoomBy(1.2)}><Plus size={16} /></button>
        <button className="btn-ghost p-1.5" title="Fit to content" onClick={() => canvasRef.current?.fitContent()}><Maximize size={16} /></button>
        <button className="btn-ghost hidden p-1.5 sm:inline-flex" onClick={cycleWheelMode}
          title={`Scroll wheel: ${WHEEL_LABEL[wheelMode]}. Click to change. Pinch always zooms.`}>
          {wheelMode === "pan" ? <Move size={16} /> : wheelMode === "zoom" ? <ZoomIn size={16} /> : <Mouse size={16} />}
        </button>
        {canEdit && prefs.showUndoRedo && (
          <>
            <div className="mx-0.5 h-5 w-px bg-slate-200" />
            <button className="btn-ghost p-1.5" title="Undo (Ctrl+Z)" onClick={api.undo}><Undo2 size={16} /></button>
            <button className="btn-ghost p-1.5" title="Redo (Ctrl+Shift+Z)" onClick={api.redo}><Redo2 size={16} /></button>
          </>
        )}
      </div>
      </>}

      {importing && (
        <div className="absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-xs text-white">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" /> {importing}
        </div>
      )}
      {!synced && status !== "connected" && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-slate-900 px-3 py-1.5 text-xs text-white">Connecting…</div>
      )}
      {error && (
        <button className="absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-rose-600 px-3 py-2 text-sm text-white" onClick={() => setError(null)}>{error}</button>
      )}

      {commentsOpen && !presenting && (
        <CommentPanel comments={comments.comments} activeId={activeComment} setActiveId={setActiveComment} draft={commentDraft} setDraft={setCommentDraft}
          api={comments} meId={p.user?.id ?? null} canEdit={canEdit} signedIn={!!p.user} showResolved={showResolved} setShowResolved={setShowResolved}
          onClose={() => { setCommentsOpen(false); setCommentDraft(null); }}
          onFocus={(c) => setCamera((cam) => ({ ...cam, x: window.innerWidth / 2 - c.x * cam.scale, y: window.innerHeight / 2 - c.y * cam.scale }))} />
      )}

      {preview && (
        <div className="absolute left-1/2 top-16 z-[35] flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg">
          <History size={15} /> Viewing: {preview.label}
          <button className="rounded-full bg-white/15 px-3 py-0.5 hover:bg-white/25" onClick={() => setPreview(null)}>Back to the live board</button>
        </div>
      )}
      {aiOpen && canEdit && !presenting && (
        <AiPanel enabled={!!p.ai} boardId={p.boardId} q={q} selected={selected} all={elements}
          onCluster={aiCluster} onSummary={aiSummary} onIdeas={aiIdeas} onDiagram={aiDiagram} onClose={() => setAiOpen(false)} />
      )}
      {plugin === "trace" && canEdit && !presenting && (
        <TracePanel selected={selected} api={api} center={() => canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 }}
          onSelect={setSelection} toast={setToast} onClose={() => setPlugin(null)} />
      )}
      {plugin && pluginCtx && canEdit && !presenting && (
        plugin === "bubbles" ? <BubblePanel ctx={pluginCtx} onClose={() => setPlugin(null)} />
          : plugin === "rooms" ? <RoomsPanel ctx={pluginCtx} onClose={() => setPlugin(null)} />
            : plugin === "materials" ? <MaterialsPanel ctx={pluginCtx} onClose={() => setPlugin(null)} />
              : plugin === "crit" ? <CritPanel ctx={pluginCtx} onClose={() => setPlugin(null)} onPresent={() => { setPlugin(null); startPresenting(false); }} />
                : plugin === "precedents" ? <PrecedentsPanel ctx={pluginCtx} onClose={() => setPlugin(null)} /> : null
      )}
      {plugin === "site" && canEdit && !presenting && (
        <SitePanel upload={uploadBlob} center={() => canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 }} onClose={() => setPlugin(null)}
          onAdd={(els, focus) => {
            api.add(els);
            setSelection([focus.id]);
            if (canvasRef.current) flyTo(canvasRef.current.cameraFor(elBounds(focus), 80));
            setToast("Site analysis added. The map has its real scale, so you can measure on it.");
          }} />
      )}
      {historyOpen && canEditBoard && !presenting && (
        <VersionPanel boardId={p.boardId} q={q} api={rawApi} previewing={preview?.id ?? null}
          onPreview={(v) => { setSelection([]); setPreview(v); if (v) requestAnimationFrame(() => canvasRef.current?.fitContent()); }}
          onRestored={(msg) => setToast(msg)}
          onClose={() => { setHistoryOpen(false); setPreview(null); }} />
      )}
      {infoDialog === "shortcuts" && <ShortcutsDialog onClose={() => setInfoDialog(null)} />}
      {infoDialog === "details" && p.details && (
        <DetailsDialog title={title} details={p.details} folder={p.folders?.find((f) => f.id === folderId)?.name ?? null}
          items={elements.length} frames={frames.length} sharing={p.sharing} teams={p.teams} onClose={() => setInfoDialog(null)} />
      )}
      {dialog === "csv" && canEdit && (
        <CsvDialog at={canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 }} members={p.members} onClose={() => setDialog(null)}
          onImport={(els) => {
            api.add(els);
            setSelection(els.map((e) => e.id));
            setDialog(null);
            setToast(`Added ${els.length === 1 && els[0].type === "table" ? "a table" : `${els.length} items`} from the CSV.`);
          }} />
      )}
      {dialog === "miro" && canEdit && (
        <MiroDialog boardId={p.boardId} q={q} at={canvasRef.current?.viewportCenter() ?? { x: 0, y: 0 }} onClose={() => setDialog(null)}
          onImport={(els, note) => {
            api.add(els);
            setDialog(null);
            setToast(note);
            setTimeout(() => canvasRef.current?.fitContent(), 250);
          }} />
      )}
      {miroPaste && canEdit && (
        <MiroPasteDialog count={miroPaste.clip.files.length} needBoard={!miroPaste.clip.boardId} error={miroPaste.error}
          onClose={() => setMiroPaste(null)}
          onSubmit={(token, remember, link) => {
            const board = miroPaste.clip.boardId ?? miroBoardId(link);
            if (!board) { setMiroPaste({ ...miroPaste, error: "That doesn't look like a Miro board link" }); return; }
            if (token) setMiroToken(token, remember);
            setMiroPaste(null);
            fetchMiroFiles({ ...miroPaste.clip, boardId: board }, token, miroPaste.at);
          }} />
      )}
      {dialog === "template" && (
        <TemplateDialog boardId={p.boardId} title={title} elements={liveElements} onClose={() => setDialog(null)}
          onDone={(msg) => { setDialog(null); setToast(msg); }} />
      )}
      {voteOpen && !commentsOpen && !historyOpen && !aiOpen && !presenting && (
        <VotePanel vote={vote} votes={votes} myVotes={myVotes} canEdit={canEdit} me={me?.name ?? ""} elements={elements}
          onStart={(v) => { api.setSession("vote", v); setSelection([]); }}
          onEnd={() => vote && api.setSession("vote", { ...vote, open: false })}
          onClear={() => { if (vote) rawApi.clearVotes(vote.id); api.setSession("vote", null); }}
          onFocus={(el) => canvasRef.current && flyTo(canvasRef.current.cameraFor({ x: el.x, y: el.y, width: el.width, height: el.height }, 200))}
          onClose={() => setVoteOpen(false)} />
      )}

      {embedDialog !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setEmbedDialog(null)}>
          <form className="card w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); if (embedDialog.trim()) addEmbed(embedDialog); setEmbedDialog(null); }}>
            <h2 className="text-lg font-semibold">Embed a link</h2>
            <input autoFocus className="input" placeholder="https://… (YouTube, Vimeo, Figma, Loom, Keystone or any web page)" value={embedDialog}
              onChange={(e) => setEmbedDialog(e.target.value)} />
            <p className="text-xs text-slate-500">Tip: you can also paste a link straight onto the board.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEmbedDialog(null)}>Cancel</button>
              <button className="btn-primary">Add</button>
            </div>
            <KeystonePicker onPick={(url) => { addEmbed(url); setEmbedDialog(null); }} />
          </form>
        </div>
      )}
      {openDocEl && (
        <DocPanel key={openDocEl.id} doc={ydoc} el={openDocEl} canEdit={canEdit} onClose={() => setOpenDoc(null)}
          onUpdate={(patch) => api.update(openDocEl.id, patch as Partial<BoardElement>)}
          onLocate={() => { const b = elBounds(openDocEl); if (canvasRef.current) flyTo(canvasRef.current.cameraFor(b, 200)); }}
          uploadImage={(f) => uploadBlob(f, f.name)} />
      )}
      {croppingEl && (
        <CropDialog el={croppingEl} onClose={() => setCropping(null)}
          onApply={(c) => { api.update(croppingEl.id, applyCrop(croppingEl, c) as Partial<BoardElement>); setCropping(null); }} />
      )}
      {playingVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4" onClick={() => setPlayingVideo(null)}>
          <div className="w-full max-w-5xl space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between text-white">
              <span className="truncate font-medium">{playingVideo.name || "Video"}</span>
              <button className="btn-ghost text-white hover:bg-white/10" onClick={() => setPlayingVideo(null)}><X size={16} /></button>
            </div>
            <video src={playingVideo.src} controls autoPlay playsInline className="max-h-[80vh] w-full rounded-lg bg-black"
              controlsList={canEdit ? undefined : "nodownload"} onContextMenu={canEdit ? undefined : (e) => e.preventDefault()} />
          </div>
        </div>
      )}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4" onClick={() => setViewing(null)}>
          <div className="w-full max-w-4xl space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between text-white">
              <span className="truncate font-medium">{viewing.title || viewing.url}</span>
              <div className="flex gap-2">
                <a className="btn-ghost text-white hover:bg-white/10" href={viewing.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Open</a>
                <button className="btn-ghost text-white hover:bg-white/10" onClick={() => setViewing(null)}><X size={16} /></button>
              </div>
            </div>
            <iframe src={embedUrlFor(viewing.url) ?? undefined} className="aspect-video w-full rounded-lg bg-black" allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" title={viewing.title || "Embedded content"} />
          </div>
        </div>
      )}

      {scaleDialog && (
        <ScaleDialog lengthPx={scaleDialog.lengthPx} plan={scaleDialog.plan} unit={unit} onClose={() => setScaleDialog(null)}
          onSavePlan={(pl, mpp) => { api.update(pl.id, { scale: { metersPerPx: mpp, refWidth: pl.width } } as Partial<BoardElement>); setToast("Scale saved for this plan"); }}
          onSaveBoard={(mpp) => { api.setSession("boardScale", { metersPerPx: mpp }); setToast("Scale saved for the board"); }} />
      )}

      {shareOpen && p.sharing && (
        <ShareDialog boardId={p.boardId} initial={p.sharing} teams={p.teams} canManage={p.canManage} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}

function dedupePeers<T extends { name: string; color: string }>(peers: T[]) {
  const seen = new Set<string>();
  return peers.filter((x) => { const k = x.name + x.color; if (seen.has(k)) return false; seen.add(k); return true; });
}

const EXT_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg",
};
function mediaTypeFromName(name: string) {
  return EXT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}
/** Largest file the board stores (no object storage on this deployment). */
const FILE_MAX_BYTES = 25 * 1024 * 1024;
/** How a file goes on the board: a picture, PDF pages, a video player, or a file card to download. */
function kindOf(f: File): "image" | "pdf" | "video" | "file" {
  const t = f.type || mediaTypeFromName(f.name);
  if (t === "application/pdf") return "pdf";
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(t)) return "image";
  if (["video/mp4", "video/webm", "video/quicktime", "video/ogg"].includes(t)) return "video";
  return "file";
}
/** A picture in a format the board doesn't keep, redrawn as PNG; null when the browser can't read it. */
async function toPng(f: File): Promise<File | null> {
  const url = URL.createObjectURL(f);
  try {
    const img = new window.Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; });
    const w = img.naturalWidth || 800, h = img.naturalHeight || 600;
    const k = Math.min(1, 4000 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return blob ? new File([blob], (f.name || "picture").replace(/\.[^.]+$/, "") + ".png", { type: "image/png" }) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
const TYPE_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_TYPES).map(([e, t]) => [t, e]));
Object.assign(TYPE_EXT, { "image/jpeg": "jpg", "video/mp4": "mp4", "image/svg+xml": "svg" });
/** Adds an extension from the file type when the name has none (Miro titles often don't). */
function withExtension(name: string, type: string) {
  const ext = TYPE_EXT[type];
  return !ext || /\.[a-z0-9]{1,5}$/i.test(name) ? name : `${name}.${ext}`;
}
function fileLabel(name: string, type: string) {
  const ext = name.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  return ext ? ext.toUpperCase() : type ? type.split("/").pop()!.toUpperCase().slice(0, 12) : "File";
}
function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/** Natural size of an uploaded video (16:9 if the browser can't read it). */
function videoSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const done = (w: number, h: number) => { v.removeAttribute("src"); v.load(); resolve({ w, h }); };
    const timer = setTimeout(() => done(640, 360), 8000);
    v.preload = "metadata";
    v.onloadedmetadata = () => { clearTimeout(timer); done(v.videoWidth || 640, v.videoHeight || 360); };
    v.onerror = () => { clearTimeout(timer); done(640, 360); };
    v.src = url;
  });
}

const CONNECTOR_STYLES: [ConnectorStyle, string, string][] = [
  ["straight", "Straight connector", "M4 18 L18 4"],
  ["curved", "Curved connector", "M4 18 C12 18 10 4 18 4"],
  ["elbow", "Angled connector", "M4 18 L11 18 L11 4 L18 4"],
];

const WHEEL_LABEL: Record<WheelMode, string> = {
  auto: "mouse wheel zooms, trackpad scrolls",
  zoom: "always zooms",
  pan: "always scrolls (hold Ctrl or ⌘ to zoom)",
};

/** Deep-copies Yjs XML content (a document's body) into an empty, already attached parent. */
function copyXml(from: Y.XmlFragment | Y.XmlElement, to: Y.XmlFragment | Y.XmlElement) {
  from.toArray().forEach((node, i) => {
    if (node instanceof Y.XmlText) {
      const t = new Y.XmlText();
      to.insert(i, [t]);
      t.applyDelta(node.toDelta());
    } else if (node instanceof Y.XmlElement) {
      const el = new Y.XmlElement(node.nodeName);
      to.insert(i, [el]);
      for (const [k, v] of Object.entries(node.getAttributes())) el.setAttribute(k, v as string);
      copyXml(node, el);
    }
  });
}

/** True below Tailwind's `sm` breakpoint, where the board switches to its phone layout. */
function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639.98px)");
    const upd = () => setPhone(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);
  return phone;
}
