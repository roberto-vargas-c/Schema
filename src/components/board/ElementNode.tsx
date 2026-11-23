"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { loadGif, type GifFrames } from "./gif";
import { isKeystoneEmbed } from "./embeds";
import { stickerUrl } from "@/lib/board/stickers";
import { Group, Rect, Text, Ellipse, Line, Image as KImage, Path, Label as KLabel, Tag } from "react-konva";
import type {
  BoardElement, CardElement, EmbedElement, ImageElement, VideoElement, StickerElement, DocElement, WallElement, MeasureElement, PenElement, ShapeElement, SymbolElement, TableElement, TopicElement,
} from "@/lib/board/types";
import { fontFamily } from "@/lib/board/types";
import { SHAPE_BY_ID } from "@/lib/board/shapes";
import { cloudPath, polygonCentroid, SYMBOL_BY_ID } from "@/lib/board/arch";

function useImage(src: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) { setImg(null); return; }
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = src;
    return () => { i.onload = null; };
  }, [src]);
  return img;
}

/** Current frame of an animated GIF, advancing on its own timing; null until decoded. */
function useGifFrame(src: string, enabled: boolean, nodeRef: React.RefObject<Konva.Image | null>) {
  const [gif, setGif] = useState<GifFrames | null>(null);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadGif(src).then((g) => { if (alive) setGif(g); });
    return () => { alive = false; };
  }, [src, enabled]);
  useEffect(() => {
    if (!gif) return;
    let i = 0, t: ReturnType<typeof setTimeout>;
    const step = () => {
      i = (i + 1) % gif.frames.length;
      setFrame(i);
      nodeRef.current?.getLayer()?.batchDraw();
      t = setTimeout(step, gif.delays[i]);
    };
    t = setTimeout(step, gif.delays[0]);
    return () => clearTimeout(t);
  }, [gif, nodeRef]);
  return gif ? gif.frames[frame] : null;
}

/**
 * Tracing paper: a filter that keeps a drawing's lines and drops its paper. Each pixel takes the tint color, and the darker it
 * was, the more opaque it stays, so white paper turns see-through and two tinted plans can be laid over each other.
 */
function lineTintFilter(hex: string) {
  const v = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return (data: ImageData) => {
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const ink = 1 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
      d[i + 3] = Math.round(d[i + 3] * Math.min(1, Math.max(0, (ink - 0.06) * 1.6)));
    }
  };
}

function ImageShape({ el }: { el: ImageElement }) {
  const img = useImage(el.src);
  const ref = useRef<Konva.Image>(null);
  const frame = useGifFrame(el.src, !!el.animated, ref);
  const tint = el.animated ? undefined : el.tint;
  const filters = useMemo(() => (tint ? [lineTintFilter(tint)] : []), [tint]);
  const c = el.crop;
  // Filters work on a cached bitmap: cache it at the picture's own resolution so the lines stay sharp when zoomed in.
  useEffect(() => {
    const node = ref.current;
    if (!node || !img) return;
    if (!tint) { node.clearCache(); node.getLayer()?.batchDraw(); return; }
    const natural = img.width * (c?.width ?? 1);
    try {
      node.cache({ pixelRatio: Math.min(4, Math.max(1, natural / Math.max(1, el.width))) });
    } catch { node.clearCache(); } // a picture from another site can't be read back
    node.getLayer()?.batchDraw();
  }, [img, tint, el.width, el.height, c?.x, c?.y, c?.width, c?.height, el.flipX, el.flipY]);
  if (!img) return <Rect width={el.width} height={el.height} fill="#f1f5f9" stroke="#cbd5e1" dash={[6, 6]} />;
  const source = frame ?? img;
  const crop = c ? { x: c.x * source.width, y: c.y * source.height, width: c.width * source.width, height: c.height * source.height } : undefined;
  return (
    <KImage ref={ref} image={source} crop={crop} width={el.width} height={el.height} filters={filters}
      scaleX={el.flipX ? -1 : 1} scaleY={el.flipY ? -1 : 1} x={el.flipX ? el.width : 0} y={el.flipY ? el.height : 0} />
  );
}

function StickerShape({ el }: { el: StickerElement }) {
  const img = useImage(el.sticker ? stickerUrl(el.sticker) ?? "" : "");
  if (el.emoji) {
    const fs = Math.min(el.width, el.height) * 0.8;
    return (
      <>
        <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0)" />
        <Text text={el.emoji} width={el.width} height={el.height} fontSize={fs} lineHeight={1} wrap="none" align="center" verticalAlign="middle"
          fontFamily="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif" fill="#111827" listening={false} />
      </>
    );
  }
  return img ? <KImage image={img} width={el.width} height={el.height} /> : <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0)" />;
}

/** Uploaded video: shows its first frame, plays in place from the button (each viewer on their own). */
function VideoShape({ el }: { el: VideoElement }) {
  const imgRef = useRef<Konva.Image>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.playsInline = true;
    v.src = `${el.src}#t=0.1`;
    const redraw = () => imgRef.current?.getLayer()?.batchDraw();
    v.onloadeddata = () => { setVideo(v); redraw(); };
    v.onseeked = redraw;
    v.onended = () => setPlaying(false);
    v.onpause = () => setPlaying(false);
    v.onplay = () => setPlaying(true);
    return () => { v.pause(); v.removeAttribute("src"); v.load(); };
  }, [el.src]);
  useEffect(() => {
    if (!playing || !video) return;
    const layer = imgRef.current?.getLayer();
    let last = 0;
    const anim = new Konva.Animation((f) => {
      if (f && f.time - last > 250) { last = f.time; setProgress(video.duration ? video.currentTime / video.duration : 0); }
    }, layer);
    anim.start();
    return () => { anim.stop(); };
  }, [playing, video]);

  const toggle = (e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
    if (!video) return;
    if (video.paused) video.play().catch(() => {}); else video.pause();
  };
  const r = Math.max(14, Math.min(34, Math.min(el.width, el.height) / 6));
  return (
    <>
      <Rect width={el.width} height={el.height} fill="#0f172a" cornerRadius={4} />
      {video && <KImage ref={imgRef} image={video} width={el.width} height={el.height} />}
      {!video && <Text text={el.name ?? "Video"} width={el.width} height={el.height} align="center" verticalAlign="middle" fill="#94a3b8" fontSize={14} listening={false} />}
      <Group x={el.width / 2} y={el.height / 2} opacity={playing ? 0 : 0.92} onClick={toggle} onTap={toggle} name="video-play">
        <Ellipse radiusX={r} radiusY={r} fill="rgba(15,23,42,0.65)" stroke="white" strokeWidth={2} />
        {playing
          ? <><Rect x={-r * 0.32} y={-r * 0.4} width={r * 0.22} height={r * 0.8} fill="white" /><Rect x={r * 0.1} y={-r * 0.4} width={r * 0.22} height={r * 0.8} fill="white" /></>
          : <Line points={[-r * 0.3, -r * 0.45, r * 0.5, 0, -r * 0.3, r * 0.45]} closed fill="white" />}
      </Group>
      {playing && <Rect x={0} y={el.height - 4} width={el.width * progress} height={4} fill="#14b8a6" listening={false} />}
      {/* While playing, a click anywhere on the video pauses it. */}
      {playing && <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0)" onClick={toggle} onTap={toggle} />}
    </>
  );
}

function textColorFor(fill: string) {
  if (!fill.startsWith("#") || fill.length !== 7) return "#111827";
  const r = parseInt(fill.slice(1, 3), 16), g = parseInt(fill.slice(3, 5), 16), b = parseInt(fill.slice(5, 7), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#111827" : "#ffffff";
}

export function Label({ el, editing }: { el: BoardElement; editing: boolean }) {
  if (editing || !el.text) return null;
  const pad = el.type === "sticky" ? 16 : el.type === "diamond" ? el.width * 0.18 : 10;
  return (
    <Text
      text={el.text}
      x={pad}
      y={el.type === "text" ? 0 : pad}
      width={Math.max(1, el.width - pad * 2)}
      height={el.type === "text" ? undefined : Math.max(1, el.height - pad * 2)}
      fontSize={el.fontSize ?? 16}
      fontFamily={fontFamily(el.font)}
      fill={el.type === "text" ? el.stroke : textColorFor(el.fill)}
      align={el.align ?? (el.type === "text" ? "left" : "center")}
      verticalAlign={el.type === "text" ? "top" : "middle"}
      lineHeight={1.25}
      wrap="word"
      ellipsis={el.type !== "text"}
      listening={false}
    />
  );
}

type Props = {
  el: BoardElement;
  /** Show who created sticky notes. */
  showAuthor?: boolean;
  dark?: boolean;
  /** Private mode: someone else's note, shown face-down. */
  hidden?: boolean;
  /** Measurement text for dimension / area elements. */
  measure?: string;
  /** Current zoom, so measurement labels stay readable. */
  zoom?: number;
  /** Table cell being edited (hidden so the editor overlay shows instead). */
  editingCell?: [number, number] | null;
  draggable: boolean;
  editing: boolean;
  selected: boolean;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, evt?: MouseEvent | PointerEvent | TouchEvent) => void;
  onDragEnd: (id: string) => void;
  onTransformEnd: (id: string) => void;
  onDblClick: (id: string) => void;
};

export function ElementNode({ el, showAuthor, dark, hidden, measure, zoom = 1, editingCell, draggable, editing, onDragStart, onDragMove, onDragEnd, onTransformEnd, onDblClick }: Props) {
  const common = {
    id: el.id,
    name: "element",
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    // Pen strokes apply their own opacity to the line (the highlighter is translucent).
    opacity: el.type === "pen" ? 1 : el.opacity ?? 1,
    draggable,
    onDragStart: () => onDragStart(el.id),
    onDragMove: (e: { evt?: MouseEvent | PointerEvent | TouchEvent }) => onDragMove(el.id, e.evt),
    onDragEnd: () => onDragEnd(el.id),
    onTransformEnd: () => onTransformEnd(el.id),
    onDblClick: () => onDblClick(el.id),
    onDblTap: () => onDblClick(el.id),
  };

  if (hidden) {
    return (
      <Group {...common} draggable={false}>
        <Rect width={el.width} height={el.height} fill="#e2e8f0" cornerRadius={3} stroke="#cbd5e1" dash={[8, 6]} />
        <Text text={"Private note"} width={el.width} height={el.height} align="center" verticalAlign="middle" fontSize={15} fill="#64748b" listening={false} />
      </Group>
    );
  }

  switch (el.type) {
    case "sticky":
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill={el.fill} cornerRadius={3}
            shadowColor="#0f172a" shadowOpacity={0.18} shadowBlur={12} shadowOffsetY={4} />
          <Label el={el} editing={editing} />
          {showAuthor && el.author && (
            <Text x={10} y={el.height - 20} width={el.width - 20} text={el.author.name} fontSize={11} fill={textColorFor(el.fill)}
              opacity={0.65} ellipsis wrap="none" listening={false} fontFamily={fontFamily()} />
          )}
        </Group>
      );
    case "rect":
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill={el.fill} stroke={el.stroke} strokeWidth={2} cornerRadius={8} />
          <Label el={el} editing={editing} />
        </Group>
      );
    case "ellipse":
      return (
        <Group {...common}>
          <Ellipse x={el.width / 2} y={el.height / 2} radiusX={el.width / 2} radiusY={el.height / 2} fill={el.fill} stroke={el.stroke} strokeWidth={2} />
          <Label el={el} editing={editing} />
        </Group>
      );
    case "diamond":
      return (
        <Group {...common}>
          <Line points={[el.width / 2, 0, el.width, el.height / 2, el.width / 2, el.height, 0, el.height / 2]} closed fill={el.fill} stroke={el.stroke} strokeWidth={2} lineJoin="round" />
          <Label el={el} editing={editing} />
        </Group>
      );
    case "text":
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0)" />
          <Label el={el} editing={editing} />
        </Group>
      );
    case "frame":
      // Only the title bar is a hit target, so you can still click and marquee-select inside a frame.
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill={el.fill} stroke={el.stroke} strokeWidth={1.5} cornerRadius={6} listening={false}
            shadowColor="#0f172a" shadowOpacity={0.06} shadowBlur={8} />
          <Rect y={-30} width={Math.min(el.width, Math.max(80, (el.text?.length ?? 5) * 9 + 24))} height={26} fill="rgba(0,0,0,0)" />
          {!editing && <Text y={-24} text={el.text || "Frame"} fontSize={15} fontStyle="600" fill={dark ? "#94a3b8" : "#475569"} listening={false} />}
        </Group>
      );
    case "pen": {
      const p = el as PenElement;
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0)" />
          <Line points={p.points} stroke={p.stroke} strokeWidth={p.strokeWidth} lineCap="round" lineJoin="round" tension={0.4} opacity={p.opacity ?? 1} />
        </Group>
      );
    }
    case "image":
      return (
        <Group {...common}>
          <ImageShape el={el as ImageElement} />
        </Group>
      );
    case "doc": {
      const d = el as DocElement;
      const fold = 22, pad = 18;
      return (
        <Group {...common}>
          <Path data={`M0 0 H${el.width - fold} L${el.width} ${fold} V${el.height} H0 Z`} fill="#ffffff" stroke="#cbd5e1" strokeWidth={1}
            shadowColor="#0f172a" shadowOpacity={0.12} shadowBlur={14} shadowOffsetY={4} />
          <Path data={`M${el.width - fold} 0 V${fold} H${el.width} Z`} fill="#e2e8f0" stroke="#cbd5e1" strokeWidth={1} />
          <Rect x={pad} y={pad} width={26} height={30} cornerRadius={4} fill="#2563eb" listening={false} />
          <Rect x={pad + 6} y={pad + 9} width={14} height={2.5} fill="#fff" listening={false} />
          <Rect x={pad + 6} y={pad + 14} width={14} height={2.5} fill="#fff" listening={false} />
          <Rect x={pad + 6} y={pad + 19} width={9} height={2.5} fill="#fff" listening={false} />
          <Text x={pad} y={pad + 44} width={el.width - pad * 2} text={d.title || "Untitled document"} fontSize={18} fontStyle="700"
            fill="#0f172a" wrap="word" ellipsis height={46} lineHeight={1.2} listening={false} />
          <Text x={pad} y={pad + 96} width={el.width - pad * 2} height={Math.max(0, el.height - pad * 2 - 96)} text={el.text || "Double-click to write"}
            fontSize={13} lineHeight={1.45} fill={el.text ? "#475569" : "#94a3b8"} wrap="word" ellipsis listening={false} />
        </Group>
      );
    }
    case "sticker":
      return (
        <Group {...common}>
          <StickerShape el={el as StickerElement} />
        </Group>
      );
    case "video":
      return (
        <Group {...common}>
          <VideoShape el={el as VideoElement} />
        </Group>
      );
    case "dimension": {
      const m = el as MeasureElement;
      const [x1, y1, x2, y2] = m.points;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const tick = 7 / zoom;
      const nx = -Math.sin(ang) * tick, ny = Math.cos(ang) * tick;
      // Keep the label upright.
      let deg = (ang * 180) / Math.PI;
      if (deg > 90 || deg < -90) deg += 180;
      const fs = 13 / zoom;
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0)" />
          <Line points={m.points} stroke={el.stroke} strokeWidth={1.5 / zoom} hitStrokeWidth={14 / zoom} />
          <Line points={[x1 - nx, y1 - ny, x1 + nx, y1 + ny]} stroke={el.stroke} strokeWidth={1.5 / zoom} />
          <Line points={[x2 - nx, y2 - ny, x2 + nx, y2 + ny]} stroke={el.stroke} strokeWidth={1.5 / zoom} />
          <KLabel x={(x1 + x2) / 2} y={(y1 + y2) / 2} rotation={deg} listening={false}>
            <Tag fill="white" stroke={el.stroke} strokeWidth={1 / zoom} cornerRadius={3 / zoom} pointerDirection="none" />
            <Text text={measure ?? ""} fontSize={fs} padding={3 / zoom} fill={el.stroke} fontStyle="600" offsetX={0} />
          </KLabel>
        </Group>
      );
    }
    case "area": {
      const m = el as MeasureElement;
      const c = polygonCentroid(m.points);
      const fs = 13 / zoom;
      return (
        <Group {...common}>
          <Line points={m.points} closed fill={el.fill} stroke={el.stroke} strokeWidth={1.5 / zoom} dash={[6 / zoom, 4 / zoom]} />
          <KLabel x={c.x} y={c.y} listening={false}>
            <Tag fill="white" stroke={el.stroke} strokeWidth={1 / zoom} cornerRadius={3 / zoom} />
            <Text text={measure ?? ""} fontSize={fs} padding={4 / zoom} fill={el.stroke} fontStyle="600" align="center" />
          </KLabel>
        </Group>
      );
    }
    case "wall": {
      const w = el as WallElement;
      if (w.points) {
        const t = w.thickness ?? 10;
        return (
          <Group {...common}>
            <Line points={w.points} closed={w.closed} stroke={el.stroke} strokeWidth={t + 2} lineJoin="miter" lineCap={w.closed ? "butt" : "square"} />
            <Line points={w.points} closed={w.closed} stroke={el.fill} strokeWidth={t} lineJoin="miter" lineCap={w.closed ? "butt" : "square"} hitStrokeWidth={Math.max(t, 12)} />
          </Group>
        );
      }
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill={el.fill} stroke={el.stroke} strokeWidth={1} />
        </Group>
      );
    }
    case "cloud":
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0)" />
          <Path data={cloudPath(el.width, el.height)} stroke={el.stroke} strokeWidth={2.5} lineJoin="round" />
          <Label el={{ ...el, fill: "#ffffff" }} editing={editing} />
        </Group>
      );
    case "card": {
      const c = el as CardElement;
      const st = CARD_STATUS[c.status] ?? CARD_STATUS.todo;
      const today = new Date().toISOString().slice(0, 10);
      const overdue = !!c.due && c.due < today && c.status !== "done";
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill="#ffffff" cornerRadius={8} stroke="#e2e8f0"
            shadowColor="#0f172a" shadowOpacity={0.1} shadowBlur={10} shadowOffsetY={3} />
          <Rect width={6} height={el.height} fill={st.color} cornerRadius={[8, 0, 0, 8]} />
          {!editing && (
            <Text x={18} y={12} width={el.width - 30} height={el.height - 46} text={el.text || "Untitled task"} fontSize={el.fontSize ?? 16}
              fontStyle="600" fill="#0f172a" wrap="word" ellipsis lineHeight={1.25} listening={false} />
          )}
          <KLabel x={18} y={el.height - 30} listening={false}>
            <Tag fill={st.bg} cornerRadius={9} />
            <Text text={st.label} fontSize={11} padding={4} fill={st.color} fontStyle="600" />
          </KLabel>
          {c.due && (
            <Text x={18 + st.label.length * 7 + 22} y={el.height - 26} text={`${overdue ? "⚠ " : ""}${formatDue(c.due)}`} fontSize={12}
              fill={overdue ? "#dc2626" : "#64748b"} listening={false} />
          )}
          {c.assignee && (
            <Group x={el.width - 26} y={el.height - 22} listening={false}>
              <Ellipse radiusX={13} radiusY={13} fill={c.assignee.color} />
              <Text x={-13} y={-6} width={26} align="center" text={initials(c.assignee.name)} fontSize={11} fontStyle="bold" fill="#ffffff" />
            </Group>
          )}
        </Group>
      );
    }
    case "table": {
      const t = el as TableElement;
      const rows = t.cells.length, cols = t.cells[0]?.length ?? 1;
      const rh = el.height / rows, cw = el.width / cols;
      const fs = el.fontSize ?? 14;
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill="#ffffff" stroke={el.stroke} strokeWidth={1.2} cornerRadius={4} />
          {t.header && <Rect width={el.width} height={rh} fill="#f1f5f9" cornerRadius={[4, 4, 0, 0]} listening={false} />}
          {Array.from({ length: rows - 1 }, (_, r) => (
            <Line key={`r${r}`} points={[0, (r + 1) * rh, el.width, (r + 1) * rh]} stroke={el.stroke} strokeWidth={1} listening={false} />
          ))}
          {Array.from({ length: cols - 1 }, (_, c) => (
            <Line key={`c${c}`} points={[(c + 1) * cw, 0, (c + 1) * cw, el.height]} stroke={el.stroke} strokeWidth={1} listening={false} />
          ))}
          {t.cells.map((row, r) => row.map((cell, c) => (
            editingCell && editingCell[0] === r && editingCell[1] === c ? null : (
              <Text key={`${r}-${c}`} x={c * cw + 8} y={r * rh} width={cw - 16} height={rh} text={cell} fontSize={fs} verticalAlign="middle"
                fontStyle={t.header && r === 0 ? "bold" : "normal"} fill="#0f172a" ellipsis wrap="none" listening={false} />
            )
          )))}
        </Group>
      );
    }
    case "topic": {
      const t = el as TopicElement;
      const root = t.level === 0;
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} cornerRadius={Math.min(el.height / 2, 28)} fill={root ? el.fill : "#ffffff"}
            stroke={el.stroke} strokeWidth={root ? 0 : 2} shadowColor="#0f172a" shadowOpacity={root ? 0.15 : 0.06} shadowBlur={8} shadowOffsetY={2} />
          <Label el={{ ...el, fill: root ? el.fill : "#ffffff", type: "rect" } as BoardElement} editing={editing} />
        </Group>
      );
    }
    case "shape": {
      const def = SHAPE_BY_ID.get((el as ShapeElement).shape);
      if (!def) return null;
      return (
        <Group {...common}>
          <Path data={def.path(el.width, el.height)} fill={el.fill} stroke={el.stroke} strokeWidth={2} lineJoin="round" />
          <Label el={{ ...el, type: "rect" } as BoardElement} editing={editing} />
        </Group>
      );
    }
    case "embed": {
      const e = el as EmbedElement;
      const video = /youtube\.com|youtu\.be|vimeo\.com|loom\.com/.test(e.url);
      const file = e.url.startsWith("/api/assets/");
      const keystone = isKeystoneEmbed(e.url);
      const icon = file ? "📄" : video ? "▶" : keystone ? "⬢" : /figma\.com/.test(e.url) ? "✦" : /maps\.|goo\.gl\/maps/.test(e.url) ? "⌖" : "🔗";
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill="#ffffff" stroke={el.stroke} cornerRadius={10}
            shadowColor="#0f172a" shadowOpacity={0.08} shadowBlur={10} shadowOffsetY={3} />
          <Rect x={12} y={12} width={el.height - 24} height={el.height - 24} cornerRadius={8} fill={video ? "#fee2e2" : "#e0f2fe"} listening={false} />
          <Text x={12} y={12} width={el.height - 24} height={el.height - 24} align="center" verticalAlign="middle" text={icon}
            fontSize={(el.height - 24) * 0.4} fill={video ? "#dc2626" : "#0369a1"} listening={false} />
          <Text x={el.height} y={16} width={el.width - el.height - 12} text={e.title || e.url} fontSize={15} fontStyle="600"
            fill="#0f172a" wrap="word" ellipsis height={40} listening={false} />
          <Text x={el.height} y={60} width={el.width - el.height - 12} text={e.description ?? ""} fontSize={12} fill="#475569"
            ellipsis wrap="word" height={Math.max(0, el.height - 92)} listening={false} />
          <Text x={el.height} y={el.height - 26} width={el.width - el.height - 12} text={e.site || hostOf(e.url)} fontSize={11} fill="#94a3b8"
            ellipsis wrap="none" listening={false} />
        </Group>
      );
    }
    case "symbol": {
      const def = SYMBOL_BY_ID.get((el as SymbolElement).symbol);
      if (!def) return null;
      const sx = el.width / def.vb[0], sy = el.height / def.vb[1];
      return (
        <Group {...common}>
          <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0)" />
          <Path data={def.d} scaleX={sx} scaleY={sy} stroke={el.stroke} strokeWidth={1.5 / Math.min(sx, sy)} fill={def.fill ?? (el.fill === "#ffffff" ? undefined : el.fill)}
            lineJoin="round" lineCap="round" />
        </Group>
      );
    }
    default:
      return null;
  }
}

export const CARD_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  todo: { label: "To do", color: "#475569", bg: "#f1f5f9" },
  doing: { label: "In progress", color: "#2563eb", bg: "#dbeafe" },
  blocked: { label: "Blocked", color: "#dc2626", bg: "#fee2e2" },
  done: { label: "Done", color: "#16a34a", bg: "#dcfce7" },
};

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

function formatDue(d: string) {
  const dt = new Date(`${d}T00:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
