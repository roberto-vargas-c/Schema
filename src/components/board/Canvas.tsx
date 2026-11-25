"use client";

import { withGroups, groupRemapper, makeGroupId } from "./arrange";
import { useDarkMode } from "@/components/ThemeToggle";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Arrow, Transformer, Line, Group, Circle, Text as KText } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  makeElement,
  type BoardElement,
  type ConnectorElement,
  type ElementType,
  type PenElement,
  type MeasureElement,
  type SymbolElement,
  type EmbedElement,
  type VideoElement,
  type WallElement,
  type ConnectorStyle,
  type TableElement,
  type TopicElement,
  type ImageElement,
  type StickerElement,
  hasPoints,
  fontFamily,
} from "@/lib/board/types";
import { ElementNode } from "./ElementNode";
import { PenStroke } from "./PenStroke";
import { TIP_BY_ID, tipColor, type PenTip } from "@/lib/board/penTips";
import { loadImage, THUMB_SIDE } from "./imageCache";
import { stickerUrl } from "@/lib/board/stickers";
import {
  DEFAULT_PX_PER_METER, formatArea, formatLength, metersPerPxAt, polygonArea, polylineLength, snapAngle, SYMBOL_BY_ID,
  type BoardScale, type Unit,
} from "@/lib/board/arch";
import type { BoardApi, Peer } from "./useBoard";
import type { GridStyle } from "./boardPrefs";
import {
  bounds,
  clampScale,
  connectorPoints,
  connectorPath,
  contains,
  hitElement,
  intersects,
  normRect,
  unionRect,
  type Camera,
  type Rect as R,
} from "./geometry";

export type Tool =
  | "select" | "hand" | "sticky" | "text" | "rect" | "ellipse" | "diamond" | "connector" | "pen" | "frame" | "comment"
  // architecture
  | "measure" | "area" | "wall" | "cloud" | "highlighter" | "calibrate" | "symbol"
  // content blocks
  | "card" | "table" | "mindmap" | "shape";

export type CanvasHandle = {
  zoomBy: (factor: number) => void;
  zoomTo: (scale: number) => void;
  fitContent: () => void;
  /** Camera that fits a world rect on screen (used for presenting frames). */
  cameraFor: (r: R, pad?: number) => Camera;
  size: () => { width: number; height: number };
  viewportCenter: () => { x: number; y: number };
  /** Move the camera (zooming out if needed, never in) so a world rect is on screen, leaving `rightInset` px free for a side panel. */
  reveal: (r: R, rightInset?: number) => void;
  /**
   * Render part of the board to a PNG data URL. `rect` is in board units (default: everything,
   * padded); `pixelsPerUnit` is the target resolution, lowered if the image would be too big.
   */
  exportImage: (opts?: { rect?: R; pixelsPerUnit?: number; type?: "image/png" | "image/jpeg" }) => { url: string; rect: R } | null;
  /**
   * Only items near the view are drawn. Before exporting, call this with the rects to export (null: the whole board) so
   * the items in them are drawn and their pictures loaded; call `endExport` afterwards.
   */
  prepareExport: (rects: (R | undefined)[] | null) => Promise<void>;
  endExport: () => void;
};

/** Browsers refuse canvases much larger than this. */
const MAX_EXPORT_SIDE = 14000;
const MAX_EXPORT_AREA = 120_000_000;

export type WheelMode = "auto" | "zoom" | "pan";

type Props = {
  elements: BoardElement[];
  api: BoardApi;
  peers: Peer[];
  canEdit: boolean;
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: string[];
  setSelection: (ids: string[]) => void;
  camera: Camera;
  setCamera: (c: Camera | ((c: Camera) => Camera)) => void;
  penColor: string;
  /** Stroke width for the pen / highlighter in screen-independent board units. */
  penWidth?: number;
  /** Tip the pen tool draws with (the highlighter tool always uses the highlighter tip). */
  penTip?: PenTip;
  onOpenVideo?: (el: VideoElement) => void;
  onOpenDoc?: (id: string) => void;
  /** An element waiting to be put down: shown as a ghost under the pointer; a click calls onPlace. */
  placing?: BoardElement | null;
  onPlace?: (at: { x: number; y: number }) => void;
  onCancelPlace?: () => void;
  showAuthors?: boolean;
  /** A document was duplicated or pasted: copy its content to the new one. */
  onCopyDoc?: (fromId: string, toId: string) => void;
  /** What the scroll wheel does: auto (mouse zooms, trackpad pans), always zoom, or always pan. */
  wheelMode?: WheelMode;
  /** Connector style for new connectors. */
  connectorStyle?: ConnectorStyle;
  /** Architecture: board fallback scale, display unit, symbol being placed, calibrate callback. */
  boardScale?: BoardScale;
  unit?: Unit;
  placingSymbol?: string | null;
  onCalibrate?: (line: { x1: number; y1: number; x2: number; y2: number }) => void;
  /** Shape id for the "shape" tool (triangle, cylinder, …). */
  placingShape?: string;
  onOpenEmbed?: (el: EmbedElement) => void;
  onComment: (p: { x: number; y: number }) => void;
  overlay?: React.ReactNode;
  /** Called when the user pans or zooms by hand (stops following someone). */
  onManualCamera?: () => void;
  /** While a vote is open, clicking an element casts a vote instead of selecting it. */
  onVote?: (id: string) => void;
  badges?: Map<string, { count: number; mine: number }>;
  hiddenIds?: Set<string>;
  /** Hide all chrome-like affordances (selection, transformer) e.g. while presenting. */
  presenting?: boolean;
  /** View settings from the board menu. */
  grid?: GridStyle;
  background?: string | null;
  showCursors?: boolean;
  showConnectors?: boolean;
  showDimensions?: boolean;
};

const SHAPE_TOOLS: Partial<Record<Tool, ElementType>> = { rect: "rect", ellipse: "ellipse", diamond: "diamond", frame: "frame", shape: "shape" };
const TEXT_TYPES = new Set<ElementType>(["sticky", "rect", "ellipse", "diamond", "text", "frame", "cloud", "card", "topic", "shape"]);

type Gesture =
  | { kind: "pan"; startX: number; startY: number; cam: Camera }
  /** A finger (or pen) holding a picked item: the ghost follows it and lifting puts it down. */
  | { kind: "place" }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: "shape"; type: ElementType; x0: number; y0: number; x1: number; y1: number }
  | { kind: "connector"; fromId?: string; x0: number; y0: number; x1: number; y1: number }
  | { kind: "pen"; points: number[]; tip: PenTip }
  | { kind: "line"; purpose: "measure" | "wall" | "calibrate"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "area"; points: number[]; cx: number; cy: number; wall?: boolean };

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(props, ref) {
  const { elements, api, peers, canEdit, tool, setTool, selection, setSelection, camera, setCamera, penColor, onComment, overlay,
    onManualCamera, onVote, badges, hiddenIds, presenting, boardScale = null, unit = "m", placingSymbol, onCalibrate,
    placingShape = "triangle", onOpenEmbed, onOpenVideo } = props;
  const wheelMode = props.wheelMode ?? "auto";
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const penTip: PenTip = tool === "highlighter" ? "highlighter" : props.penTip ?? "pen";
  const penWidth = props.penWidth ?? TIP_BY_ID[penTip].defaultWidth;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const shiftDown = useRef(false);
  const [guides, setGuides] = useState<number[][]>([]);
  const dark = useDarkMode();
  const [shiftHeld, setShiftHeld] = useState(false);
  // Ghost preview of what a click will put down: a picked sticker/doc, or the sticky, card, text or symbol tool.
  const [ghostPt, setGhostPt] = useState<{ x: number; y: number } | null>(null);
  const ghostFor = useMemo((): BoardElement | null => {
    if (!canEdit) return null;
    if (props.placing) return props.placing;
    if (tool === "sticky" || tool === "text" || tool === "card" || tool === "mindmap") {
      const el = makeElement(tool === "mindmap" ? "topic" : tool, 0, 0);
      return { ...el, x: -el.width / 2, y: -el.height / 2 };
    }
    if (tool === "symbol" && placingSymbol) {
      const def = SYMBOL_BY_ID.get(placingSymbol);
      if (!def) return null;
      const k = metersPerPxAt(elements, ghostPt ?? { x: 0, y: 0 }, boardScale);
      const pxPerM = k ? 1 / k : DEFAULT_PX_PER_METER;
      const w = def.size[0] * pxPerM, h = def.size[1] * pxPerM;
      return Object.assign(makeElement("symbol", -w / 2, -h / 2, { width: w, height: h, fill: "#ffffff", stroke: "#111827" }), { symbol: def.id });
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.placing, tool, placingSymbol, canEdit, boardScale, elements.length]);
  // Touch screens have no hover: show a freshly picked item in the middle of the view so it is
  // visible before it is put down. A mouse shows it under the pointer as soon as it moves.
  const lastPointerType = useRef("mouse");
  useEffect(() => {
    const f = (e: PointerEvent) => { lastPointerType.current = e.pointerType; };
    window.addEventListener("pointerdown", f, true);
    return () => window.removeEventListener("pointerdown", f, true);
  }, []);
  useEffect(() => {
    if (!props.placing || lastPointerType.current === "mouse") return;
    const c = cameraRef.current;
    setGhostPt({ x: (size.width / 2 - c.x) / c.scale, y: (size.height / 2 - c.y) / c.scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.placing]);
  /** Element under the pointer while the connector tool is active (its connection points are shown). */
  const [hoverId, setHoverId] = useState<string | null>(null);
  useEffect(() => { if (tool !== "connector") setHoverId(null); }, [tool]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { shiftDown.current = e.shiftKey; setShiftHeld(e.shiftKey); };
    window.addEventListener("keydown", f);
    window.addEventListener("keyup", f);
    return () => { window.removeEventListener("keydown", f); window.removeEventListener("keyup", f); };
  }, []);
  const dragState = useRef<{ start: Map<string, { x: number; y: number }>; children: Map<string, string[]> } | null>(null);

  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const editing = editingId ? byId.get(editingId) : undefined;
  /** While exporting, the rects whose items must be drawn even if they are off screen ("all": the whole board). */
  const [exportRects, setExportRects] = useState<R[] | "all" | null>(null);
  /** Items that must stay drawn while off screen: the children a frame drag is moving. */
  const [pinned, setPinned] = useState<Set<string> | null>(null);

  // ── Sizing ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── Transformer follows selection ─────────────────────────────────────────
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes = selection
      .filter((id) => {
        const e = byId.get(id);
        return e && e.type !== "connector" && !e.locked && id !== editingId;
      })
      .map((id) => stage.findOne(`#${id}`))
      .filter(Boolean) as Konva.Node[];
    tr.nodes(canEdit && !presenting && !onVote ? nodes : []);
    tr.getLayer()?.batchDraw();
  }, [selection, byId, canEdit, editingId, presenting, onVote]);

  const toWorld = useCallback(
    (sx: number, sy: number) => ({ x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale }),
    [camera],
  );
  const pointerWorld = () => {
    const p = stageRef.current?.getPointerPosition();
    return p ? toWorld(p.x, p.y) : null;
  };

  // ── Camera controls ───────────────────────────────────────────────────────
  // Wheel, pinch and drag-to-pan events can arrive faster than the screen refreshes: apply them once per frame.
  const camQueue = useRef<((c: Camera) => Camera)[]>([]);
  const camFrame = useRef(0);
  const queueCamera = useCallback((u: Camera | ((c: Camera) => Camera)) => {
    camQueue.current.push(typeof u === "function" ? u : () => u);
    if (camFrame.current) return;
    camFrame.current = requestAnimationFrame(() => {
      camFrame.current = 0;
      const q = camQueue.current;
      camQueue.current = [];
      setCamera((c) => q.reduce((acc, f) => f(acc), c));
    });
  }, [setCamera]);
  useEffect(() => () => cancelAnimationFrame(camFrame.current), []);

  // Zooming with the wheel, a trackpad pinch or two fingers doesn't redraw the board on every step: the canvas already drawn is
  // scaled on screen right away (like Miro does), and the board is redrawn sharp a few times a second and once the gesture stops.
  const live = useRef<{ cam: Camera; idle: number; lastDraw: number; ending: boolean } | null>(null);
  const showLive = useCallback(() => {
    const l = live.current, el = stageRef.current?.container(), box = containerRef.current;
    if (!el) return;
    const base = cameraRef.current;
    if (!l || l.cam === base) { el.style.transform = ""; el.style.transformOrigin = ""; return; }
    const k = l.cam.scale / base.scale;
    el.style.transformOrigin = "0 0";
    el.style.transform = `matrix(${k}, 0, 0, ${k}, ${l.cam.x - base.x * k}, ${l.cam.y - base.y * k})`;
    if (box) {
      const g = gridStep(l.cam.scale);
      box.style.backgroundSize = `${g}px ${g}px`;
      box.style.backgroundPosition = `${l.cam.x}px ${l.cam.y}px`;
    }
  }, []);
  const liveZoom = useCallback((u: (c: Camera) => Camera) => {
    let l = live.current;
    const cam = u(l?.cam ?? cameraRef.current);
    if (!l) l = live.current = { cam, idle: 0, lastDraw: performance.now(), ending: false };
    l.cam = cam;
    l.ending = false;
    showLive();
    window.clearTimeout(l.idle);
    const draw = (end: boolean) => {
      const c = live.current;
      if (!c) return;
      c.lastDraw = performance.now();
      c.ending = end;
      setCamera(c.cam);
    };
    l.idle = window.setTimeout(() => draw(true), 120);
    if (performance.now() - l.lastDraw > 220) draw(false);
  }, [setCamera, showLive]);
  // Once React has drawn a camera, scale the canvas from there (or not at all when the gesture is over). The board is drawn
  // first, in this same frame, so the picture never jumps.
  useLayoutEffect(() => {
    const l = live.current;
    if (!l) return;
    stageRef.current?.draw();
    if (l.ending && l.cam === camera) live.current = null;
    showLive();
  }, [camera, showLive]);
  useEffect(() => () => { if (live.current) window.clearTimeout(live.current.idle); }, []);
  const zoomLiveAround = useCallback((factor: number, sx: number, sy: number) => {
    liveZoom((c) => {
      const scale = clampScale(c.scale * factor);
      const wx = (sx - c.x) / c.scale, wy = (sy - c.y) / c.scale;
      return { scale, x: sx - wx * scale, y: sy - wy * scale };
    });
  }, [liveZoom]);
  const zoomAround = useCallback(
    (factor: number, sx: number, sy: number) => {
      queueCamera((c) => {
        const scale = clampScale(c.scale * factor);
        const wx = (sx - c.x) / c.scale, wy = (sy - c.y) / c.scale;
        return { scale, x: sx - wx * scale, y: sy - wy * scale };
      });
    },
    [queueCamera],
  );

  // Read the container directly: the size state lags one render behind on first mount.
  const liveSize = () => {
    const el = containerRef.current;
    return el && el.clientWidth ? { width: el.clientWidth, height: el.clientHeight } : size;
  };

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => zoomAround(f, size.width / 2, size.height / 2),
    zoomTo: (s) => zoomAround(s / camera.scale, size.width / 2, size.height / 2),
    fitContent: () => {
      const size = liveSize();
      const b = unionRect(elements.map(bounds));
      if (!b) return setCamera({ x: size.width / 2, y: size.height / 2, scale: 1 });
      // Leave room for the toolbar (left) and top bar, and for frame titles drawn above frames.
      const padX = 90, padTop = 100, padBottom = 70;
      const bb = { ...b, y: b.y - 30, height: b.height + 30 };
      const scale = clampScale(Math.min((size.width - padX * 2) / Math.max(bb.width, 1), (size.height - padTop - padBottom) / Math.max(bb.height, 1), 1.5));
      setCamera({ scale, x: size.width / 2 - (bb.x + bb.width / 2) * scale, y: padTop + (size.height - padTop - padBottom) / 2 - (bb.y + bb.height / 2) * scale });
    },
    cameraFor: (r, pad = 60) => {
      const size = liveSize();
      const scale = clampScale(Math.min((size.width - pad * 2) / Math.max(r.width, 1), (size.height - pad * 2) / Math.max(r.height, 1)));
      return { scale, x: size.width / 2 - (r.x + r.width / 2) * scale, y: size.height / 2 - (r.y + r.height / 2) * scale };
    },
    size: () => liveSize(),
    viewportCenter: () => { const size = liveSize(); return toWorld(size.width / 2, size.height / 2); },
    reveal: (r, rightInset = 0) => {
      const size = liveSize();
      const padX = 90, padTop = 100, padBottom = 70;
      const area = { left: padX, top: padTop, right: size.width - rightInset - 24, bottom: size.height - padBottom };
      const bb = { ...r, y: r.y - 30, height: r.height + 30 };
      const sx = bb.x * camera.scale + camera.x, sy = bb.y * camera.scale + camera.y;
      if (sx >= area.left && sy >= area.top && sx + bb.width * camera.scale <= area.right && sy + bb.height * camera.scale <= area.bottom) return;
      const w = Math.max(area.right - area.left, 100), h = Math.max(area.bottom - area.top, 100);
      const scale = clampScale(Math.min(camera.scale, w / Math.max(bb.width, 1), h / Math.max(bb.height, 1)));
      setCamera({ scale, x: area.left + w / 2 - (bb.x + bb.width / 2) * scale, y: area.top + h / 2 - (bb.y + bb.height / 2) * scale });
    },
    exportImage: (opts) => {
      const stage = stageRef.current;
      const all = unionRect(elements.map(bounds));
      const rect = opts?.rect ?? (all ? { x: all.x - 40, y: all.y - 70, width: all.width + 80, height: all.height + 110 } : null);
      if (!stage || !rect || rect.width <= 0 || rect.height <= 0) return null;
      const prevNodes = trRef.current?.nodes() ?? [];
      trRef.current?.nodes([]);
      let ppu = opts?.pixelsPerUnit ?? 2;
      ppu = Math.min(ppu, MAX_EXPORT_SIDE / rect.width, MAX_EXPORT_SIDE / rect.height, Math.sqrt(MAX_EXPORT_AREA / (rect.width * rect.height)));
      const s = camera.scale;
      try {
        const url = stage.toDataURL({
          x: rect.x * s + camera.x, y: rect.y * s + camera.y, width: rect.width * s, height: rect.height * s,
          pixelRatio: ppu / s, mimeType: opts?.type ?? "image/png", quality: 0.92,
        });
        return { url, rect };
      } finally {
        trRef.current?.nodes(prevNodes);
      }
    },
    prepareExport: async (rects) => {
      const want = rects === null || rects.some((r) => !r) ? null : (rects as R[]);
      const inside = want ? elements.filter((e) => e.type !== "connector" && want.some((r) => intersects(r, worldBox(e, byId)))) : elements;
      // Load the pictures first, so they are drawn as soon as their nodes mount.
      const srcs = new Set<string>();
      for (const e of inside) {
        if (e.type === "image") srcs.add((e as ImageElement).src);
        else if (e.type === "sticker" && (e as StickerElement).sticker) { const u = stickerUrl((e as StickerElement).sticker!); if (u) srcs.add(u); }
      }
      await Promise.all([...srcs].map((src) => Promise.race([loadImage(src), new Promise((r) => setTimeout(r, 15000))])));
      setExportRects(want ?? "all");
      // Let React and Konva draw the newly mounted nodes.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    endExport: () => setExportRects(null),
  }), [zoomAround, size, camera, elements, setCamera, toWorld, byId]);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    onManualCamera?.();
    const ev = e.evt;
    // The point under the pointer on screen (the canvas may be scaled on screen mid-zoom, so not Konva's pointer position).
    const box = containerRef.current?.getBoundingClientRect();
    const sx = box ? ev.clientX - box.left : p.x, sy = box ? ev.clientY - box.top : p.y;
    // Pinch on a trackpad arrives as ctrl+wheel. Otherwise the setting decides: "auto" zooms with a
    // mouse wheel and pans with two fingers on a trackpad, which is told apart by its small, smooth deltas.
    const mouseWheel = ev.deltaMode === 1 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 40 && Number.isInteger(ev.deltaY));
    const zoom = ev.ctrlKey || ev.metaKey || wheelMode === "zoom" || (wheelMode === "auto" && mouseWheel);
    if (zoom) {
      const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
      // A wheel notch (100) zooms about 1.4×; a pinch zooms about twice as far as the fingers move.
      const k = ev.ctrlKey && !mouseWheel ? 0.02 : 0.0034;
      zoomLiveAround(Math.exp(-Math.max(-300, Math.min(300, dy)) * k), sx, sy);
    } else {
      queueCamera((c) => ({ ...c, x: c.x - ev.deltaX, y: c.y - ev.deltaY }));
    }
  };

  // ── Touch: two-finger pinch to zoom and pan (iPad, touch screens); Safari trackpad pinch ──
  const pinch = useRef<{ pts: Map<number, { x: number; y: number }>; start?: { d: number; mx: number; my: number; cam: Camera } }>({ pts: new Map() });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const begin = () => {
      const [a, b] = [...pinch.current.pts.values()];
      pinch.current.start = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam: live.current?.cam ?? cameraRef.current };
      setGesture(null);
      stageRef.current?.find(".element").forEach((n) => { if (n.isDragging()) n.stopDrag(); });
      onManualCamera?.();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pinch.current.pts.set(e.pointerId, local(e));
      if (pinch.current.pts.size === 2) begin();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !pinch.current.pts.has(e.pointerId)) return;
      pinch.current.pts.set(e.pointerId, local(e));
      const st = pinch.current.start;
      if (!st || pinch.current.pts.size < 2) return;
      e.stopPropagation();
      const [a, b] = [...pinch.current.pts.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const scale = clampScale(st.cam.scale * (d / st.d));
      const wx = (st.mx - st.cam.x) / st.cam.scale, wy = (st.my - st.cam.y) / st.cam.scale;
      liveZoom(() => ({ scale, x: mx - wx * scale, y: my - wy * scale }));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pinch.current.pts.delete(e.pointerId);
      if (pinch.current.pts.size < 2 && pinch.current.start) {
        pinch.current.start = undefined;
        // Swallow the leftover finger so it doesn't start a selection.
        pinch.current.pts.clear();
        pinchEnded.current = performance.now();
      }
    };
    // Safari on a Mac sends trackpad pinches as gesture events instead of ctrl+wheel.
    let gScale = 1;
    const gStart = (e: Event) => { e.preventDefault(); gScale = 1; };
    const gChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const r = el.getBoundingClientRect();
      zoomLiveAround(Math.pow(ge.scale / gScale, 2), ge.clientX - r.left, ge.clientY - r.top); // twice the fingers, like a trackpad pinch
      gScale = ge.scale;
    };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    el.addEventListener("gesturestart", gStart);
    el.addEventListener("gesturechange", gChange);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
      el.removeEventListener("gesturestart", gStart);
      el.removeEventListener("gesturechange", gChange);
    };
  }, [liveZoom, zoomLiveAround, onManualCamera]);
  const pinchEnded = useRef(0);
  const lastAreaDown = useRef<{ x: number; y: number; t: number } | null>(null);
  const pinching = () => !!pinch.current.start || performance.now() - pinchEnded.current < 150;

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const clipboard = useRef<BoardElement[]>([]);
  const clipboardStamp = useRef("");
  useEffect(() => {
    const isTyping = () => {
      const a = document.activeElement;
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a as HTMLElement | null)?.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") { setSpaceDown(true); e.preventDefault(); return; }
      if (e.key === "Escape") { props.onCancelPlace?.(); setGesture(null); setSelection([]); setTool("select"); return; }
      if (e.key === "Enter" && finishAreaRef.current()) return;
      if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSelection(elements.map((x) => x.id)); return; }
      if (!canEdit) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) api.redo(); else api.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); api.redo(); return; }
      if ((e.key === "Tab" || e.key === "Enter") && selection.length === 1 && byId.get(selection[0])?.type === "topic") {
        e.preventDefault();
        addTopic(byId.get(selection[0]) as TopicElement, e.key === "Tab" ? "child" : "sibling");
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection.length) { e.preventDefault(); api.remove(selection); setSelection([]); return; }
      if (mod && e.key.toLowerCase() === "g" && selection.length) {
        e.preventDefault();
        const gid = e.shiftKey || selection.length < 2 ? undefined : makeGroupId();
        api.updateMany(selection.map((id) => ({ id, patch: { groupId: gid } })));
        return;
      }
      // Copy and paste go through the system clipboard events below, so a copy from another app wins.
      if (mod && e.key.toLowerCase() === "d") {
        const src = selection.map((id) => byId.get(id)!).filter(Boolean);
        if (!src.length) return;
        e.preventDefault();
        const copies = duplicate(src);
        src.forEach((s, i) => { if (s.type === "doc") props.onCopyDoc?.(s.id, copies[i].id); });
        api.add(copies);
        setSelection(copies.map((c) => c.id));
        return;
      }
      if (e.key.startsWith("Arrow") && selection.length) {
        e.preventDefault();
        const d = e.shiftKey ? 20 : 2;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        api.updateMany(selection.map((id) => byId.get(id)).filter((x): x is BoardElement => !!x && x.type !== "connector")
          .map((x) => ({ id: x.id, patch: { x: x.x + dx, y: x.y + dy } })));
        return;
      }
      if (mod || e.altKey) return;
      const shortcuts: Record<string, Tool> = {
        v: "select", h: "hand", n: "sticky", t: "text", r: "rect", o: "ellipse", l: "connector", p: "pen", f: "frame", c: "comment",
        m: "measure", a: "area", w: "wall", k: "calibrate", q: "cloud", i: "highlighter", g: "mindmap", d: "card",
      };
      const t = shortcuts[e.key.toLowerCase()];
      if (t) setTool(t);
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceDown(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [api, byId, canEdit, elements, selection, setSelection, setTool]);

  // Copy puts a marker next to the items' text; paste uses our items only when the marker is still there.
  useEffect(() => {
    const typing = () => {
      const a = document.activeElement;
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a as HTMLElement | null)?.isContentEditable;
    };
    const onCopy = (e: ClipboardEvent) => {
      if (typing() || !selection.length || !e.clipboardData) return;
      const src = selection.map((id) => byId.get(id)!).filter(Boolean);
      if (!src.length) return;
      const stamp = `${Date.now()}-${Math.random()}`;
      clipboard.current = src;
      clipboardStamp.current = stamp;
      e.preventDefault();
      e.clipboardData.setData("text/plain", src.map((x) => x.text ?? "").filter(Boolean).join("\n"));
      e.clipboardData.setData(SCHEMA_CLIP, stamp);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (typing() || !canEdit || !clipboard.current.length) return;
      if (e.clipboardData?.getData(SCHEMA_CLIP) !== clipboardStamp.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const src = clipboard.current;
      const copies = duplicate(src);
      src.forEach((s, i) => { if (s.type === "doc") props.onCopyDoc?.(s.id, copies[i].id); });
      api.add(copies);
      setSelection(copies.map((c) => c.id));
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste, true);
    return () => { window.removeEventListener("copy", onCopy); window.removeEventListener("paste", onPaste, true); };
  }, [api, byId, canEdit, selection, setSelection, props]);

  // ── Pointer handling ─────────────────────────────────────────────────────
  const elementIdFromTarget = (t: Konva.Node): string | null => {
    let n: Konva.Node | null = t;
    while (n && n !== stageRef.current) {
      if (n.name() === "element" || n.name() === "connector") return n.id();
      n = n.getParent();
    }
    return null;
  };

  const minZ = () => elements.reduce((m, e) => Math.min(m, e.z), 0);

  const onPointerDown = (e: KonvaEventObject<PointerEvent>) => {
    if (pinching()) return;
    const p = pointerWorld();
    if (p && props.placing && canEdit && e.evt.button === 0) {
      // Touch has no hover, so the ghost follows the finger and lifting it puts the item down.
      if (e.evt.pointerType !== "mouse") { setGhostPt(p); setGesture({ kind: "place" }); return; }
      props.onPlace?.(p); return;
    }
    const sp = stageRef.current?.getPointerPosition();
    if (!p || !sp) return;
    if (editingId) commitEdit();
    const isTransformerPart = e.target.getParent()?.className === "Transformer";
    if (isTransformerPart) return;

    // Hand tool, space, or holding the middle or right mouse button pans.
    if (tool === "hand" || spaceDown || e.evt.button === 1 || e.evt.button === 2) {
      onManualCamera?.();
      setGesture({ kind: "pan", startX: sp.x, startY: sp.y, cam: camera });
      return;
    }
    if (onVote) {
      const id = elementIdFromTarget(e.target);
      const el = id ? byId.get(id) : undefined;
      if (el && el.type !== "connector" && el.type !== "frame") { onVote(el.id); return; }
      // Clicking empty space while voting pans the board.
      onManualCamera?.();
      setGesture({ kind: "pan", startX: sp.x, startY: sp.y, cam: camera });
      return;
    }
    if (tool === "comment") { onComment(p); setTool("select"); return; }

    if (tool === "select" || !canEdit) {
      const id = elementIdFromTarget(e.target);
      if (id) {
        // Grouped items are picked up together.
        const ids = withGroups([id], elements);
        if (e.evt.shiftKey) setSelection(selection.includes(id) ? selection.filter((s) => !ids.includes(s)) : Array.from(new Set([...selection, ...ids])));
        else if (!selection.includes(id)) setSelection(ids);
        return;
      }
      if (!e.evt.shiftKey) setSelection([]);
      setGesture({ kind: "marquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.evt.shiftKey });
      return;
    }

    if (tool === "table") {
      const el = makeElement("table", 0, 0);
      el.x = p.x - el.width / 2;
      el.y = p.y - el.height / 2;
      api.add([el]);
      setSelection([el.id]);
      setTool("select");
      return;
    }
    if (tool === "sticky" || tool === "text" || tool === "card" || tool === "mindmap") {
      const el = makeElement(tool === "mindmap" ? "topic" : tool, 0, 0);
      el.x = p.x - el.width / 2;
      el.y = p.y - el.height / 2;
      api.add([el]);
      setSelection([el.id]);
      setTool("select");
      setEditingId(el.id);
      return;
    }
    const shapeType = SHAPE_TOOLS[tool];
    if (shapeType) { setGesture({ kind: "shape", type: shapeType, x0: p.x, y0: p.y, x1: p.x, y1: p.y }); return; }
    if (tool === "connector") {
      const hit = hitElement(elements, p);
      setGesture({ kind: "connector", fromId: hit?.id, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    if (tool === "pen" || tool === "highlighter") { setGesture({ kind: "pen", points: [p.x, p.y], tip: penTip }); return; }
    if (tool === "measure" || tool === "calibrate") {
      setGesture({ kind: "line", purpose: tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    if (tool === "cloud") { setGesture({ kind: "shape", type: "cloud", x0: p.x, y0: p.y, x1: p.x, y1: p.y }); return; }
    if (tool === "area" || tool === "wall") {
      const wall = tool === "wall";
      if (gesture?.kind !== "area") {
        const sp = stageRef.current?.getPointerPosition();
        lastAreaDown.current = sp ? { x: sp.x, y: sp.y, t: performance.now() } : null;
        setGesture({ kind: "area", points: [p.x, p.y], cx: p.x, cy: p.y, wall }); return;
      }
      const [fx, fy] = gesture.points;
      // A second click on the same spot finishes the shape (Konva's dblclick also fires for two quick clicks far apart).
      const sp = stageRef.current?.getPointerPosition();
      const prev = lastAreaDown.current;
      lastAreaDown.current = sp ? { x: sp.x, y: sp.y, t: performance.now() } : null;
      if (sp && prev && performance.now() - prev.t < 450 && Math.hypot(sp.x - prev.x, sp.y - prev.y) < 6) { finishArea(); return; }
      if (gesture.points.length >= (wall ? 4 : 6) && Math.hypot(p.x - fx, p.y - fy) < 10 / camera.scale) { finishArea(true); return; }
      const lx = gesture.points[gesture.points.length - 2], ly = gesture.points[gesture.points.length - 1];
      // Shift keeps each new segment at 15° steps from the last corner.
      const q = shiftDown.current ? snapAngle(lx, ly, p.x, p.y) : p;
      if (Math.hypot(q.x - lx, q.y - ly) > 2 / camera.scale) setGesture({ ...gesture, points: [...gesture.points, q.x, q.y] });
      return;
    }
    if (tool === "symbol" && placingSymbol) {
      const def = SYMBOL_BY_ID.get(placingSymbol);
      if (!def) return;
      const k = metersPerPxAt(elements, p, boardScale);
      const pxPerM = k ? 1 / k : DEFAULT_PX_PER_METER;
      const w = def.size[0] * pxPerM, h = def.size[1] * pxPerM;
      const el = makeElement("symbol", p.x - w / 2, p.y - h / 2, { width: w, height: h, fill: "#ffffff", stroke: "#111827" }) as SymbolElement;
      el.symbol = def.id;
      api.add([el]);
      setSelection([el.id]);
      setTool("select");
      return;
    }
  };

  // A pan with the right or middle button can end outside the board (or the window).
  const panning = gesture?.kind === "pan";
  useEffect(() => {
    if (!panning) return;
    const end = () => setGesture(null);
    window.addEventListener("pointerup", end);
    window.addEventListener("blur", end);
    return () => { window.removeEventListener("pointerup", end); window.removeEventListener("blur", end); };
  }, [panning]);

  const lastCursor = useRef(0);
  const onPointerMove = () => {
    if (pinch.current.start) return;
    const p = pointerWorld();
    const sp = stageRef.current?.getPointerPosition();
    if (!p || !sp) return;
    const now = performance.now();
    if (now - lastCursor.current > 40) { lastCursor.current = now; api.setCursor(p); }
    if (ghostFor) setGhostPt(p);
    if (tool === "connector") {
      const h = hitElement(elements, p, gesture?.kind === "connector" ? gesture.fromId : undefined)?.id ?? null;
      if (h !== hoverId) setHoverId(h);
    }
    if (!gesture) return;
    switch (gesture.kind) {
      case "pan":
        queueCamera({ ...gesture.cam, x: gesture.cam.x + sp.x - gesture.startX, y: gesture.cam.y + sp.y - gesture.startY });
        break;
      case "marquee":
      case "shape":
      case "connector":
        setGesture({ ...gesture, x1: p.x, y1: p.y });
        break;
      case "pen":
        // Shift draws a straight line from where the stroke started (15° steps).
        if (shiftDown.current) {
          const q = snapAngle(gesture.points[0], gesture.points[1], p.x, p.y);
          setGesture({ ...gesture, points: [gesture.points[0], gesture.points[1], q.x, q.y] });
        } else setGesture({ ...gesture, points: [...gesture.points, p.x, p.y] });
        break;
      case "line": {
        const q = shiftDown.current ? snapAngle(gesture.x0, gesture.y0, p.x, p.y) : p;
        setGesture({ ...gesture, x1: q.x, y1: q.y });
        break;
      }
      case "area": {
        const n = gesture.points.length;
        const q = shiftDown.current ? snapAngle(gesture.points[n - 2], gesture.points[n - 1], p.x, p.y) : p;
        setGesture({ ...gesture, cx: q.x, cy: q.y });
        break;
      }
    }
  };

  const onPointerUp = () => {
    const g = gesture;
    if (g?.kind === "area") return; // areas are finished with a double-click, Enter, or by clicking the first point
    setGesture(null);
    if (!g) return;
    if (g.kind === "place") {
      const p = pointerWorld() ?? ghostPt;
      if (p && props.placing) props.onPlace?.(p);
      return;
    }
    if (g.kind === "line") {
      const len = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
      if (len < 5 / camera.scale) return;
      if (g.purpose === "calibrate") { onCalibrate?.({ x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1 }); setTool("select"); return; }
      if (g.purpose === "measure") {
        const x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1);
        const el = makeElement("dimension", x, y, {
          width: Math.max(1, Math.abs(g.x1 - g.x0)), height: Math.max(1, Math.abs(g.y1 - g.y0)), fill: "transparent", stroke: "#be123c",
        }) as MeasureElement;
        el.points = [g.x0 - x, g.y0 - y, g.x1 - x, g.y1 - y];
        api.add([el]);
        return;
      }
      // Wall: a rotated rect whose centerline runs from the start to the end point; 20 cm thick at plan scale.
      const k = metersPerPxAt(elements, { x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2 }, boardScale);
      const t = k ? 0.2 / k : 10;
      const a = Math.atan2(g.y1 - g.y0, g.x1 - g.x0);
      const el = makeElement("wall", g.x0 + Math.sin(a) * t / 2, g.y0 - Math.cos(a) * t / 2, {
        width: len, height: t, rotation: (a * 180) / Math.PI, fill: "#374151", stroke: "#1f2937",
      });
      api.add([el]);
      return;
    }
    if (g.kind === "marquee") {
      const r = normRect(g.x0, g.y0, g.x1, g.y1);
      if (r.width < 3 && r.height < 3) return;
      const hits = elements.filter((el) => {
        if (el.type === "connector" || el.locked) return false;
        const b = bounds(el);
        return el.type === "frame" ? contains(r, b) : intersects(r, b);
      }).map((el) => el.id);
      const grouped = withGroups(hits, elements);
      setSelection(g.additive ? Array.from(new Set([...selection, ...grouped])) : grouped);
    } else if (g.kind === "shape") {
      let r = normRect(g.x0, g.y0, g.x1, g.y1);
      const el = makeElement(g.type, 0, 0);
      if (r.width < 8 && r.height < 8) r = { x: g.x0 - el.width / 2, y: g.y0 - el.height / 2, width: el.width, height: el.height };
      Object.assign(el, r);
      if (g.type === "frame") el.z = minZ() - 1;
      if (g.type === "cloud") Object.assign(el, { fill: "transparent", stroke: "#dc2626", fontSize: 16, text: "" });
      if (g.type === "shape") (el as { shape?: string }).shape = placingShape;
      api.add([el]);
      setSelection([el.id]);
      setTool("select");
    } else if (g.kind === "connector") {
      const to = hitElement(elements, { x: g.x1, y: g.y1 }, g.fromId);
      if (Math.hypot(g.x1 - g.x0, g.y1 - g.y0) < 10 && !to) return;
      const c = makeElement("connector", 0, 0) as ConnectorElement;
      Object.assign(c, {
        width: 0, height: 0, stroke: penColor === "#ffffff" ? "#334155" : penColor,
        from: { id: g.fromId, x: g.x0, y: g.y0 },
        to: { id: to?.id, x: g.x1, y: g.y1 },
        arrowEnd: true, arrowStart: false, style: props.connectorStyle ?? "straight",
      });
      api.add([c]);
      setSelection([c.id]);
    } else if (g.kind === "pen") {
      if (g.points.length < 4) return;
      const xs = g.points.filter((_, i) => i % 2 === 0), ys = g.points.filter((_, i) => i % 2 === 1);
      const x = Math.min(...xs), y = Math.min(...ys);
      const el = makeElement("pen", x, y) as PenElement;
      Object.assign(el, {
        width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y),
        points: g.points.map((v, i) => (i % 2 === 0 ? v - x : v - y)),
        stroke: tipColor(g.tip, penColor),
        strokeWidth: penWidth, opacity: TIP_BY_ID[g.tip].opacity, fill: "transparent",
        ...(g.tip !== "pen" ? { tip: g.tip } : {}),
      });
      api.add([el]);
    }
  };

  function finishArea(close = false): boolean {
    const g = gesture;
    if (g?.kind !== "area") return false;
    setGesture(null);
    // Drop near-duplicate points (a double-click adds the last point twice).
    const pts: number[] = [];
    for (let i = 0; i < g.points.length; i += 2) {
      const n = pts.length;
      if (n && Math.hypot(g.points[i] - pts[n - 2], g.points[i + 1] - pts[n - 1]) < 3 / camera.scale) continue;
      pts.push(g.points[i], g.points[i + 1]);
    }
    if (pts.length < (g.wall ? 4 : 6)) return true;
    const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
    const x = Math.min(...xs), y = Math.min(...ys);
    const rel = pts.map((v, i) => (i % 2 === 0 ? v - x : v - y));
    if (g.wall) {
      // 20 cm thick at plan scale.
      const k = metersPerPxAt(elements, { x: (x + Math.max(...xs)) / 2, y: (y + Math.max(...ys)) / 2 }, boardScale);
      const el = makeElement("wall", x, y, {
        width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y), fill: "#374151", stroke: "#1f2937",
      }) as WallElement;
      Object.assign(el, { points: rel, thickness: k ? 0.2 / k : 10, closed: close && pts.length >= 6 });
      api.add([el]);
      return true;
    }
    const el = makeElement("area", x, y, {
      width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y),
      fill: "rgba(20,163,139,0.14)", stroke: "#0f766e",
    }) as MeasureElement;
    el.points = rel;
    api.add([el]);
    return true;
  }

  /** Mind map: add a child (to the right) or a sibling (below) of a topic, connected to its parent. */
  function addTopic(from: TopicElement, kind: "child" | "sibling") {
    const parentOf = (t: BoardElement) => {
      const c = elements.find((e) => e.type === "connector" && (e as ConnectorElement).to.id === t.id && byId.get((e as ConnectorElement).from.id ?? "")?.type === "topic");
      return c ? (byId.get((c as ConnectorElement).from.id!) as TopicElement) : undefined;
    };
    const parent = kind === "child" ? from : parentOf(from);
    if (!parent) { addTopic(from, "child"); return; }
    const kids = elements.filter((e) => e.type === "connector" && (e as ConnectorElement).from.id === parent.id)
      .map((c) => byId.get((c as ConnectorElement).to.id ?? ""))
      .filter((k): k is BoardElement => !!k && k.type === "topic");
    const level = parent.level + 1;
    const palette = ["#0f8573", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04"];
    const color = level === 1 ? palette[kids.length % palette.length] : parent.stroke;
    const last = kids.sort((a, b) => a.y - b.y).at(-1);
    const h = 44;
    const x = parent.x + parent.width + 80;
    const y = last ? last.y + last.height + 18 : parent.y + parent.height / 2 - h / 2;
    const el = makeElement("topic", x, y, { width: 170, height: h, fill: "#ffffff", stroke: color, text: "", fontSize: 15 }) as TopicElement;
    el.root = parent.root;
    el.level = level;
    const c = makeElement("connector", 0, 0) as ConnectorElement;
    Object.assign(c, {
      width: 0, height: 0, stroke: color, arrowEnd: false, arrowStart: false, style: "curved",
      from: { id: parent.id, x: parent.x + parent.width, y: parent.y + parent.height / 2 },
      to: { id: el.id, x, y: y + h / 2 },
    });
    api.add([el, c]);
    setSelection([el.id]);
    setEditingCell(null);
    setEditingId(el.id);
  }

  const finishAreaRef = useRef(finishArea);
  finishAreaRef.current = finishArea;

  /** Text shown on dimension and area elements, using the plan scale under them. */
  const measureLabel = (el: BoardElement): string | undefined => {
    if (el.type !== "dimension" && el.type !== "area") return undefined;
    const m = el as MeasureElement;
    const k = metersPerPxAt(elements, { x: el.x + el.width / 2, y: el.y + el.height / 2 }, boardScale);
    if (el.type === "dimension") {
      const len = polylineLength(m.points);
      return k ? formatLength(len * k, unit) : `${Math.round(len)} px (no scale)`;
    }
    const a = polygonArea(m.points), per = polylineLength(m.points, true);
    return k ? `${formatArea(a * k * k, unit)}\nP ${formatLength(per * k, unit)}` : `${Math.round(a)} px² (no scale)`;
  };
  const livePreview = (x0: number, y0: number, x1: number, y1: number) => {
    const k = metersPerPxAt(elements, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, boardScale);
    const len = Math.hypot(x1 - x0, y1 - y0);
    return k ? formatLength(len * k, unit) : `${Math.round(len)} px`;
  };

  // ── Drag & transform ─────────────────────────────────────────────────────
  const onDragStart = (id: string) => {
    if (!dragState.current) dragState.current = { start: new Map(), children: new Map() };
    const ds = dragState.current;
    const el = byId.get(id);
    if (!el) return;
    ds.start.set(id, { x: el.x, y: el.y });
    if (el.type === "frame") {
      const fb = bounds(el);
      const kids = elements.filter((o) => o.id !== id && o.type !== "connector" && o.type !== "frame" && !selection.includes(o.id) && contains(fb, bounds(o)));
      ds.children.set(id, kids.map((k) => k.id));
      kids.forEach((k) => ds.start.set(k.id, { x: k.x, y: k.y }));
      if (kids.length) setPinned((p) => new Set([...(p ?? []), ...kids.map((k) => k.id)]));
    }
  };

  const onDragMove = (id: string, evt?: MouseEvent | PointerEvent | TouchEvent) => {
    const ds = dragState.current;
    const node = stageRef.current?.findOne(`#${id}`);
    // Smart guides: a single dragged item snaps to the edges and centers of other items (Alt drags freely).
    if (node && selection.length <= 1 && !(evt && "altKey" in evt && evt.altKey)) {
      const el = byId.get(id);
      if (el && !el.rotation) {
        const snap = snapToOthers({ x: node.x(), y: node.y(), width: el.width, height: el.height }, elements, id, 6 / camera.scale);
        if (snap.dx || snap.dy) node.position({ x: node.x() + snap.dx, y: node.y() + snap.dy });
        setGuides(snap.guides);
      }
    }
    const kids = ds?.children.get(id);
    if (!ds || !kids?.length) return;
    const s = ds.start.get(id);
    if (!node || !s) return;
    const dx = node.x() - s.x, dy = node.y() - s.y;
    for (const k of kids) {
      const kn = stageRef.current?.findOne(`#${k}`);
      const ks = ds.start.get(k);
      if (kn && ks) kn.position({ x: ks.x + dx, y: ks.y + dy });
    }
  };

  const onDragEnd = (id: string) => {
    setGuides([]);
    const stage = stageRef.current;
    const ds = dragState.current;
    const node = stage?.findOne(`#${id}`);
    if (!node) return;
    const patches = [{ id, patch: { x: node.x(), y: node.y() } }];
    const s0 = ds?.start.get(id);
    for (const k of ds?.children.get(id) ?? []) {
      const kn = stage?.findOne(`#${k}`);
      const ks = ds?.start.get(k);
      if (kn) patches.push({ id: k, patch: { x: kn.x(), y: kn.y() } });
      // A child that wasn't drawn (off screen) moves by the same amount as the frame.
      else if (ks && s0) patches.push({ id: k, patch: { x: ks.x + node.x() - s0.x, y: ks.y + node.y() - s0.y } });
    }
    api.updateMany(patches);
    if (ds?.children.get(id)?.length) setPinned(null);
    ds?.children.delete(id);
    ds?.start.delete(id);
    if (ds && ds.start.size === 0) dragState.current = null;
    // Konva fires dragend for every node in a multi-selection; clear state once the last one ends.
    queueMicrotask(() => { if (dragState.current && !stage?.isDragging?.()) dragState.current = null; });
  };

  const onTransformEnd = (id: string) => {
    const node = stageRef.current?.findOne(`#${id}`);
    const el = byId.get(id);
    if (!node || !el) return;
    const sx = node.scaleX(), sy = node.scaleY();
    node.scale({ x: 1, y: 1 });
    const patch: Partial<BoardElement> & { points?: number[] } = {
      x: node.x(), y: node.y(), rotation: node.rotation(),
      width: Math.max(20, el.width * sx), height: Math.max(20, el.height * sy),
    };
    if (hasPoints(el)) patch.points = el.points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy));
    if (el.type === "text" || el.type === "sticky") patch.fontSize = Math.max(8, Math.round((el.fontSize ?? 16) * (el.type === "text" ? sy : 1)));
    api.update(id, patch);
  };

  // ── Text editing ─────────────────────────────────────────────────────────
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [editingCell, setEditingCell] = useState<[number, number] | null>(null);
  const startEdit = (id: string) => {
    const el = byId.get(id);
    if (!el) return;
    if (el.type === "embed") { onOpenEmbed?.(el as EmbedElement); return; }
    if (el.type === "video") { onOpenVideo?.(el as VideoElement); return; }
    if (el.type === "doc") { props.onOpenDoc?.(el.id); return; }
    if (!canEdit || hiddenIds?.has(id) || onVote) return;
    if (el.type === "table") {
      const p = pointerWorld();
      const t = el as TableElement;
      if (!p || el.rotation) return;
      const rows = t.cells.length, cols = t.cells[0]?.length ?? 1;
      const r = Math.min(rows - 1, Math.max(0, Math.floor(((p.y - el.y) / el.height) * rows)));
      const c = Math.min(cols - 1, Math.max(0, Math.floor(((p.x - el.x) / el.width) * cols)));
      setEditingCell([r, c]);
      setEditingId(id);
      return;
    }
    if (!TEXT_TYPES.has(el.type)) return;
    setEditingCell(null);
    setEditingId(id);
  };
  // Load the draft and focus the editor synchronously, before the next keystroke is handled,
  // so fast typing right after Tab/Enter/double-click lands in the right element or cell.
  const editKey = editing ? `${editing.id}|${editingCell?.[0] ?? ""}|${editingCell?.[1] ?? ""}` : "";
  const loadedKey = useRef("");
  /** Text the editor should show before it is focused and selected; null when nothing is pending. */
  const needsFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!editKey || !editing) { loadedKey.current = ""; return; }
    if (loadedKey.current === editKey) return;
    loadedKey.current = editKey;
    const text = editing.type === "table" && editingCell ? (editing as TableElement).cells[editingCell[0]]?.[editingCell[1]] ?? "" : editing.text ?? "";
    setDraft(text);
    needsFocus.current = text;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey]);
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (needsFocus.current === null || !ta || ta.value !== needsFocus.current) return;
    needsFocus.current = null;
    ta.focus();
    ta.select();
  });

  const commitEdit = () => {
    const el = editingId ? byId.get(editingId) : undefined;
    setEditingId(null);
    if (!el) return;
    if (el.type === "table") {
      const cell = editingCell;
      setEditingCell(null);
      if (!cell) return;
      const cells = (el as TableElement).cells.map((row) => [...row]);
      if (cells[cell[0]]) cells[cell[0]][cell[1]] = draft;
      api.update(el.id, { cells } as Partial<BoardElement>);
      return;
    }
    const patch: Partial<BoardElement> = { text: draft };
    if (el.type === "text") {
      const ta = textareaRef.current;
      if (ta) patch.height = Math.max(el.fontSize ?? 24, ta.scrollHeight / camera.scale);
      if (!draft.trim()) { api.remove([el.id]); return; }
    }
    api.update(el.id, patch);
  };

  const editorStyle = (): React.CSSProperties | undefined => {
    if (!editing) return undefined;
    const s = camera.scale;
    if (editing.type === "table" && editingCell) {
      const t = editing as TableElement;
      const rows = t.cells.length, cols = t.cells[0]?.length ?? 1;
      const rh = editing.height / rows, cw = editing.width / cols;
      return {
        position: "absolute", left: (editing.x + editingCell[1] * cw) * s + camera.x, top: (editing.y + editingCell[0] * rh) * s + camera.y,
        width: cw * s, height: rh * s, padding: `${Math.max(0, (rh - (editing.fontSize ?? 14) * 1.3) / 2) * s}px ${8 * s}px`,
        fontSize: (editing.fontSize ?? 14) * s, lineHeight: 1.3, background: "#ffffff", color: "#0f172a",
      };
    }
    if (editing.type === "card") {
      return {
        position: "absolute", left: (editing.x + 14) * s + camera.x, top: (editing.y + 8) * s + camera.y,
        width: (editing.width - 22) * s, height: (editing.height - 44) * s, padding: 4 * s,
        fontSize: (editing.fontSize ?? 16) * s, fontWeight: 600, lineHeight: 1.25, background: "#ffffff", color: "#0f172a",
      };
    }
    const isFrame = editing.type === "frame";
    const pad = (editing.type === "sticky" ? 16 : editing.type === "text" ? 0 : 10) * s;
    return {
      position: "absolute",
      left: editing.x * s + camera.x,
      top: (isFrame ? editing.y - 28 : editing.y) * s + camera.y,
      width: (isFrame ? Math.min(editing.width, 320) : editing.width) * s,
      height: isFrame ? 26 * s : editing.type === "text" ? undefined : editing.height * s,
      minHeight: editing.type === "text" ? (editing.fontSize ?? 24) * 1.3 * s : undefined,
      padding: pad,
      fontSize: (isFrame ? 15 : editing.fontSize ?? 16) * s,
      lineHeight: 1.25,
      fontFamily: isFrame ? undefined : fontFamily(editing.font),
      textAlign: isFrame ? "left" : editing.align ?? (editing.type === "text" ? "left" : "center"),
      background: editing.type === "text" || isFrame ? "rgba(255,255,255,0.9)" : editing.type === "topic" && (editing as TopicElement).level > 0 ? "#ffffff" : editing.fill,
      color: editing.type === "text" ? editing.stroke : editing.type === "topic" && (editing as TopicElement).level === 0 ? "#ffffff" : "#111827",
      borderRadius: editing.type === "topic" ? Math.min(editing.height / 2, 28) * s : undefined,
      transform: `rotate(${editing.rotation}deg)`,
      transformOrigin: "top left",
    };
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const cursor = gesture?.kind === "pan" ? "grabbing" : tool === "hand" || spaceDown ? "grab" : tool === "select" ? "default" : "crosshair";
  const s = camera.scale;
  // Grid dots shrink with the zoom, and the spacing doubles when they'd get too dense.
  const gridSize = gridStep(s);
  const dotR = Math.max(0.45, Math.min(1.3, 1.1 * Math.sqrt(s)));
  const gridColor = dark ? "#334155" : "#cbd5e1";
  const gridImage = props.grid === "none" || s <= 0.06 ? undefined
    : props.grid === "lines" ? `linear-gradient(to right, ${gridColor}80 1px, transparent 1px), linear-gradient(to bottom, ${gridColor}80 1px, transparent 1px)`
    : `radial-gradient(circle, ${gridColor} ${dotR}px, transparent ${dotR + 0.5}px)`;
  // Width × height of a single selected item, shown under it.
  const sized = props.showDimensions && selection.length === 1 && !gesture ? byId.get(selection[0]) : undefined;
  const sizedBox = sized && sized.type !== "connector" && sized.type !== "pen" ? bounds(sized) : null;
  // In real units when the item sits on a scaled plan (or the board has a scale), otherwise in board pixels.
  const sizeLabel = (b: { x: number; y: number; width: number; height: number }) => {
    const k = metersPerPxAt(elements, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, boardScale);
    return k ? `${formatLength(b.width * k, unit)} × ${formatLength(b.height * k, unit)}` : `${Math.round(b.width)} × ${Math.round(b.height)}`;
  };
  const peerSel = peers.flatMap((p) => (p.selection ?? []).map((id) => ({ id, color: p.color })));

  // Element nodes get the same handler functions on every render, so a pan or zoom doesn't redraw them.
  const handlers = useRef({ onDragStart, onDragMove, onDragEnd, onTransformEnd, startEdit });
  handlers.current = { onDragStart, onDragMove, onDragEnd, onTransformEnd, startEdit };
  const stable = useMemo(() => ({
    onDragStart: (id: string) => handlers.current.onDragStart(id),
    onDragMove: (id: string, evt?: MouseEvent | PointerEvent | TouchEvent) => handlers.current.onDragMove(id, evt),
    onDragEnd: (id: string) => handlers.current.onDragEnd(id),
    onTransformEnd: (id: string) => handlers.current.onTransformEnd(id),
    onDblClick: (id: string) => handlers.current.startEdit(id),
  }), []);
  // Dark-mode copies are kept per element, so an unchanged element stays the same object.
  const darkCopies = useRef(new WeakMap<BoardElement, BoardElement>());
  const shown = (raw: BoardElement) => {
    if (!dark) return raw;
    let d = darkCopies.current.get(raw);
    if (!d) { d = forDark(raw); darkCopies.current.set(raw, d); }
    return d;
  };
  // Only items in or near the view are drawn (and their pictures loaded): half a screen of margin on every side,
  // so items are ready before they scroll in. Selected, edited and playing items are always kept.
  const view = useMemo(() => {
    const w = size.width / s, h = size.height / s, m = Math.max(w, h) * 0.5;
    return { x: -camera.x / s - m, y: -camera.y / s - m, width: w + m * 2, height: h + m * 2 };
  }, [camera.x, camera.y, s, size.width, size.height]);
  const drawn = useMemo(() => {
    if (exportRects === "all") return elements;
    const rects = exportRects ? [view, ...exportRects] : [view];
    const keep = new Set<string>(selection);
    if (editingId) keep.add(editingId);
    pinned?.forEach((id) => keep.add(id));
    return elements.filter((e) => e.type === "video" || keep.has(e.id) || rects.some((r) => intersects(r, worldBox(e, byId))));
  }, [elements, byId, view, exportRects, selection, editingId, pinned]);
  // Pictures drawn at no more than their preview's size use the preview (never in an export, which wants every pixel).
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const isSmall = (el: BoardElement) => {
    if (el.type !== "image" || exportRects) return false;
    const c = (el as ImageElement).crop;
    const shown = Math.max(el.width / (c?.width || 1), el.height / (c?.height || 1));
    return shown * s * dpr <= THUMB_SIDE;
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        cursor,
        touchAction: "none",
        // Dark mode keeps its own canvas color; the board's background color applies in light mode.
        backgroundColor: dark ? "#12171e" : props.background ?? "#f8fafc",
        backgroundImage: gridImage,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerLeave={() => { api.setCursor(null); setGhostPt(null); setHoverId(null); }}
      onMouseDown={(e) => {
        // Clicking the canvas must not move focus to <body>: that would blur a text editor
        // the click just opened. Release focus from any other field so shortcuts keep working.
        if (!(e.target instanceof HTMLCanvasElement)) return;
        e.preventDefault();
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== textareaRef.current && active !== document.body) active.blur();
      }}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={camera.x}
        y={camera.y}
        scaleX={s}
        scaleY={s}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.evt.preventDefault()}
      >
        <Layer>
          {drawn.map((raw) => {
            const el = shown(raw);
            if (el.type === "connector") {
              if (props.showConnectors === false) return null;
              const c = el as ConnectorElement;
              const { points: pts, bezier } = connectorPath(c, byId);
              const sel = selection.includes(c.id);
              return (
                <Arrow key={c.id} id={c.id} name="connector" points={pts} bezier={bezier} lineJoin="round"
                  dash={c.pattern === "dashed" ? [10 * (c.weight ?? 2) / 2, 7 * (c.weight ?? 2) / 2] : c.pattern === "dotted" ? [0.1, 6 * (c.weight ?? 2) / 2] : undefined} stroke={sel ? "#0f8573" : c.stroke} fill={sel ? "#0f8573" : c.stroke}
                  strokeWidth={c.weight ?? 2} hitStrokeWidth={Math.max(16, (c.weight ?? 2) + 8)} pointerLength={12} pointerWidth={12}
                  pointerAtBeginning={c.arrowStart} pointerAtEnding={c.arrowEnd} lineCap="round" />
              );
            }
            return (
              <ElementNode key={el.id} el={el} dark={dark} showAuthor={props.showAuthors} measure={measureLabel(el)}
                zoom={el.type === "dimension" || el.type === "area" ? s : 1} small={isSmall(el)} editingCell={editingId === el.id ? editingCell : null} selected={selection.includes(el.id)} editing={editingId === el.id && el.type !== "frame" ? true : editingId === el.id}
                draggable={canEdit && tool === "select" && !spaceDown && !el.locked && editingId !== el.id && !onVote && !presenting}
                hidden={hiddenIds?.has(el.id) ?? false}
                onDragStart={stable.onDragStart} onDragMove={stable.onDragMove} onDragEnd={stable.onDragEnd} onTransformEnd={stable.onTransformEnd} onDblClick={stable.onDblClick} />
            );
          })}
          <Transformer ref={trRef} rotateEnabled flipEnabled={false}
            rotationSnaps={shiftHeld ? [0, 45, 90, 135, 180, 225, 270, 315] : [0, 90, 180, 270]} rotationSnapTolerance={shiftHeld ? 22.5 : 4} anchorSize={9} borderStroke="#0f8573" anchorStroke="#0f8573" anchorCornerRadius={2}
            ignoreStroke boundBoxFunc={(o, n) => (n.width < 10 || n.height < 10 ? o : n)} />
        </Layer>
        <Layer listening={false}>
          {selection.map((id) => {
            const el = byId.get(id);
            if (!el || el.type === "connector" || (canEdit && !el.locked)) return null;
            return <Rect key={id} x={el.x - 4} y={el.y - 4} width={el.width + 8} height={el.height + 8} stroke="#0f8573" strokeWidth={1.5 / s} dash={[6 / s, 4 / s]} />;
          })}
          {peerSel.map(({ id, color }) => {
            const el = byId.get(id);
            if (!el || el.type === "connector") return null;
            return <Rect key={`${id}-${color}`} x={el.x - 6} y={el.y - 6} width={el.width + 12} height={el.height + 12} stroke={color} strokeWidth={2 / s} cornerRadius={4} />;
          })}
          {badges && Array.from(badges.entries()).map(([id, b]) => {
            const el = byId.get(id);
            if (!el || (!b.count && !b.mine)) return null;
            const r = 14 / s;
            return (
              <Group key={`vote-${id}`} x={el.x + el.width} y={el.y}>
                <Circle radius={r} fill={b.mine ? "#0f8573" : "#334155"} stroke="white" strokeWidth={2 / s} />
                <KText text={String(b.count || b.mine)} fontSize={13 / s} fontStyle="bold" fill="white" width={r * 2} height={r * 2} x={-r} y={-r} align="center" verticalAlign="middle" />
              </Group>
            );
          })}
          {gesture?.kind === "marquee" && (
            <Rect {...normRect(gesture.x0, gesture.y0, gesture.x1, gesture.y1)} fill="rgba(20,163,139,0.08)" stroke="#14a38b" strokeWidth={1 / s} />
          )}
          {gesture?.kind === "shape" && (
            <Rect {...normRect(gesture.x0, gesture.y0, gesture.x1, gesture.y1)} stroke="#0f8573" dash={[6 / s, 4 / s]} strokeWidth={1.5 / s}
              cornerRadius={gesture.type === "ellipse" ? 999 : 6} />
          )}
          {gesture?.kind === "connector" && (() => {
            const to = hitElement(elements, { x: gesture.x1, y: gesture.y1 }, gesture.fromId);
            const preview = { from: { id: gesture.fromId, x: gesture.x0, y: gesture.y0 }, to: { id: to?.id, x: gesture.x1, y: gesture.y1 }, style: props.connectorStyle } as ConnectorElement;
            const { points, bezier } = connectorPath(preview, byId);
            return <Arrow points={points} bezier={bezier} stroke="#0f8573" fill="#0f8573" strokeWidth={2} dash={[8, 6]} />;
          })()}
          {gesture?.kind === "pen" && (
            <PenStroke points={gesture.points} stroke={tipColor(gesture.tip, penColor)} width={penWidth} tip={gesture.tip}
              opacity={TIP_BY_ID[gesture.tip].opacity} />
          )}
          {gesture?.kind === "line" && (
            <>
              <Line points={[gesture.x0, gesture.y0, gesture.x1, gesture.y1]}
                stroke={gesture.purpose === "wall" ? "#374151" : gesture.purpose === "calibrate" ? "#7c3aed" : "#be123c"}
                strokeWidth={gesture.purpose === "wall" ? 6 / s : 2 / s} dash={gesture.purpose === "wall" ? undefined : [6 / s, 4 / s]} />
              <KText x={gesture.x1 + 10 / s} y={gesture.y1 + 10 / s} text={livePreview(gesture.x0, gesture.y0, gesture.x1, gesture.y1)}
                fontSize={13 / s} fill="#111827" fontStyle="600" />
            </>
          )}
          {gesture?.kind === "area" && gesture.wall && (
            <>
              <Line points={[...gesture.points, gesture.cx, gesture.cy]} stroke="#374151" opacity={0.75} lineJoin="miter" lineCap="square"
                strokeWidth={(() => { const k = metersPerPxAt(elements, { x: gesture.cx, y: gesture.cy }, boardScale); return k ? 0.2 / k : 10; })()} />
              <Circle x={gesture.points[0]} y={gesture.points[1]} radius={5 / s} fill="#0f766e" />
              <KText x={gesture.cx + 12 / s} y={gesture.cy + 12 / s} fontSize={12 / s} fill="#374151"
                text={livePreview(gesture.points[gesture.points.length - 2], gesture.points[gesture.points.length - 1], gesture.cx, gesture.cy) + "\nClick for corners. Double-click or Enter to finish, click the first point to close"} />
            </>
          )}
          {gesture?.kind === "area" && !gesture.wall && (
            <>
              <Line points={[...gesture.points, gesture.cx, gesture.cy]} closed fill="rgba(20,163,139,0.12)" stroke="#0f766e" strokeWidth={1.5 / s} dash={[6 / s, 4 / s]} />
              <Circle x={gesture.points[0]} y={gesture.points[1]} radius={5 / s} fill="#0f766e" />
              <KText x={gesture.cx + 12 / s} y={gesture.cy + 12 / s} fontSize={12 / s} fill="#0f766e"
                text={gesture.points.length >= 4 ? "Double-click, press Enter or click the first point to finish" : "Click to add corners"} />
            </>
          )}
          {guides.map((g, i) => (
            <Line key={`guide${i}`} points={g} stroke="#e11d48" strokeWidth={1 / s} listening={false} />
          ))}
          {ghostFor && ghostPt && (!gesture || gesture.kind === "place") && (
            <Group x={ghostPt.x} y={ghostPt.y} opacity={0.55} listening={false}>
              <ElementNode el={ghostFor} draggable={false} editing={false} selected={false} zoom={s}
                onDragStart={() => {}} onDragMove={() => {}} onDragEnd={() => {}} onTransformEnd={() => {}} onDblClick={() => {}} />
            </Group>
          )}
          {tool === "connector" && (() => {
            // Connection points: on the element under the pointer, and on the one a new connector starts from.
            const ids = new Set<string>();
            if (hoverId) ids.add(hoverId);
            if (gesture?.kind === "connector" && gesture.fromId) ids.add(gesture.fromId);
            return [...ids].map((id) => {
              const el = byId.get(id);
              if (!el) return null;
              const b = bounds(el);
              const target = gesture?.kind === "connector" && id === hoverId;
              const pts = [[b.x + b.width / 2, b.y], [b.x + b.width, b.y + b.height / 2], [b.x + b.width / 2, b.y + b.height], [b.x, b.y + b.height / 2]];
              return (
                <Group key={id} listening={false}>
                  <Rect {...b} stroke="#14a38b" strokeWidth={(target ? 2 : 1.25) / s} dash={target ? undefined : [5 / s, 4 / s]} cornerRadius={6 / s} />
                  {pts.map(([x, y], i) => (
                    <Circle key={i} x={x} y={y} radius={(target ? 6 : 5) / s} fill={target ? "#14a38b" : "#ffffff"} stroke="#0f8573" strokeWidth={1.5 / s} />
                  ))}
                </Group>
              );
            });
          })()}
        </Layer>
      </Stage>

      {editing && (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey || editing.type === "frame" || editing.type === "topic" || editing.type === "table"))) {
              e.preventDefault(); commitEdit();
            }
            if (e.key === "Tab" && editing.type === "table" && editingCell) {
              e.preventDefault();
              const t = editing as TableElement;
              const cols = t.cells[0]?.length ?? 1, rows = t.cells.length;
              let [r, c] = editingCell;
              c += e.shiftKey ? -1 : 1;
              if (c >= cols) { c = 0; r = (r + 1) % rows; }
              if (c < 0) { c = cols - 1; r = (r - 1 + rows) % rows; }
              commitEdit();
              setEditingCell([r, c]);
              setEditingId(editing.id);
            }
          }}
          className="resize-none overflow-hidden rounded-sm border-2 border-brand-500 outline-none"
          style={editorStyle()}
        />
      )}

      {sizedBox && (
        <div className="pointer-events-none absolute left-0 top-0 z-[5] whitespace-nowrap rounded bg-slate-800/85 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
          style={{ transform: `translate(${(sizedBox.x + sizedBox.width / 2) * s + camera.x}px, ${(sizedBox.y + sizedBox.height) * s + camera.y + 10}px) translateX(-50%)` }}>
          {sizeLabel(sizedBox)}
        </div>
      )}
      {/* Remote cursors */}
      {props.showCursors !== false && peers.map((p) =>
        p.cursor ? (
          <div key={p.clientId} className="pointer-events-none absolute left-0 top-0 transition-transform duration-75"
            style={{ transform: `translate(${p.cursor.x * s + camera.x}px, ${p.cursor.y * s + camera.y}px)` }}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M1 1l6 15 2.2-6.2L16 7.6z" fill={p.color} stroke="white" strokeWidth="1.2" /></svg>
            <span className="ml-3 rounded-md px-1.5 py-0.5 text-xs font-medium text-white shadow" style={{ background: p.color }}>{p.name}</span>
          </div>
        ) : null,
      )}
      {overlay}
    </div>
  );
});

type Box = { x: number; y: number; width: number; height: number };
/**
 * Snaps a box to the left/center/right and top/middle/bottom lines of the other items when one is within
 * `thr`. Returns the nudge and the guide lines to draw (each [x1, y1, x2, y2]).
 */
function snapToOthers(b: Box, all: BoardElement[], skip: string, thr: number): { dx: number; dy: number; guides: number[][] } {
  const others = all.filter((o) => o.id !== skip && o.type !== "connector" && !o.rotation && o.type !== "pen");
  const xs = [b.x, b.x + b.width / 2, b.x + b.width], ys = [b.y, b.y + b.height / 2, b.y + b.height];
  let bestX: { d: number; at: number } | null = null, bestY: { d: number; at: number } | null = null;
  for (const o of others) {
    for (const t of [o.x, o.x + o.width / 2, o.x + o.width]) for (const v of xs) {
      const d = t - v;
      if (Math.abs(d) <= thr && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: t };
    }
    for (const t of [o.y, o.y + o.height / 2, o.y + o.height]) for (const v of ys) {
      const d = t - v;
      if (Math.abs(d) <= thr && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: t };
    }
  }
  const dx = bestX?.d ?? 0, dy = bestY?.d ?? 0;
  const nb = { x: b.x + dx, y: b.y + dy, width: b.width, height: b.height };
  const guides: number[][] = [];
  const near = (v: number, list: number[]) => list.some((t) => Math.abs(t - v) < 0.5);
  if (bestX) {
    // Span the guide over the moved box and every item sharing that line.
    const hits = others.filter((o) => near(bestX!.at, [o.x, o.x + o.width / 2, o.x + o.width]));
    const y1 = Math.min(nb.y, ...hits.map((o) => o.y)), y2 = Math.max(nb.y + nb.height, ...hits.map((o) => o.y + o.height));
    guides.push([bestX.at, y1 - 12, bestX.at, y2 + 12]);
  }
  if (bestY) {
    const hits = others.filter((o) => near(bestY!.at, [o.y, o.y + o.height / 2, o.y + o.height]));
    const x1 = Math.min(nb.x, ...hits.map((o) => o.x)), x2 = Math.max(nb.x + nb.width, ...hits.map((o) => o.x + o.width));
    guides.push([x1 - 12, bestY.at, x2 + 12, bestY.at]);
  }
  return { dx, dy, guides };
}

/** Spacing of the grid on screen: it shrinks with the zoom and doubles when the dots would get too dense. */
function gridStep(scale: number) {
  let g = 24 * scale;
  while (g < 14) g *= 2;
  return g;
}

/** Board-space box an element can draw into, generous for rotated items; connectors span the items they join. */
function worldBox(el: BoardElement, byId: Map<string, BoardElement>): R {
  if (el.type === "connector") {
    const c = el as ConnectorElement;
    const end = (e: ConnectorElement["from"]) => {
      const t = e.id ? byId.get(e.id) : undefined;
      return t && t.type !== "connector" ? worldBox(t, byId) : { x: e.x, y: e.y, width: 0, height: 0 };
    };
    return unionRect([end(c.from), end(c.to)])!;
  }
  let x0 = 0, y0 = 0, x1 = el.width, y1 = el.height;
  if (hasPoints(el) && el.points.length >= 2) {
    for (let i = 0; i + 1 < el.points.length; i += 2) {
      x0 = Math.min(x0, el.points[i]); x1 = Math.max(x1, el.points[i]);
      y0 = Math.min(y0, el.points[i + 1]); y1 = Math.max(y1, el.points[i + 1]);
    }
  }
  if (el.rotation) {
    // Rotation turns the item around its top-left corner: anything within its farthest corner's reach.
    const r = Math.max(Math.hypot(x0, y0), Math.hypot(x1, y0), Math.hypot(x0, y1), Math.hypot(x1, y1));
    return { x: el.x - r, y: el.y - r, width: r * 2, height: r * 2 };
  }
  // Frame titles and author labels sit just outside the box.
  return { x: el.x + x0, y: el.y + y0 - 30, width: x1 - x0, height: y1 - y0 + 30 };
}

const DARK_INK = new Set(["text", "pen", "dimension", "area", "cloud", "connector", "symbol"]);
/** In dark mode, near-black lines and text are drawn light so they stay readable; white frames turn dark. Display only. */
function forDark(el: BoardElement): BoardElement {
  if (DARK_INK.has(el.type) && isDarkInk(el.stroke)) return { ...el, stroke: "#e5e7eb" };
  if (el.type === "frame" && el.fill.toLowerCase() === "#ffffff") return { ...el, fill: "#1c232d", stroke: "#334155" };
  return el;
}
function isDarkInk(c: string) {
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 70;
}

/** Clipboard type that marks a copy made on this board (the value matches the copy). */
const SCHEMA_CLIP = "application/x-schema-elements";

/** Copy elements with fresh ids, keeping connectors between copied elements attached to the copies. Copied groups become new groups. */
function duplicate(src: BoardElement[]): BoardElement[] {
  const idMap = new Map<string, string>();
  const offset = 24;
  const newGroupId = groupRemapper();
  const copies = src.map((e) => {
    const c = makeElement(e.type, 0, 0);
    idMap.set(e.id, c.id);
    return { ...e, id: c.id, groupId: newGroupId(e.groupId), x: e.x + offset, y: e.y + offset, z: e.type === "frame" ? e.z : Date.now() + Math.random() } as BoardElement;
  });
  return copies.map((c) => {
    if (c.type !== "connector") return c;
    const k = c as ConnectorElement;
    const remap = (end: ConnectorElement["from"]) => ({
      id: end.id ? idMap.get(end.id) : undefined,
      x: end.x + offset,
      y: end.y + offset,
    });
    return { ...k, from: remap(k.from), to: remap(k.to) };
  });
}

export type { R as WorldRect };
