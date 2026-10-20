import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatMs, type Row } from "./model";

const ROW_H = 30;
const LABEL_FRACTION = 0.42;

export const OP_COLORS: Record<string, string> = {
  invoke_agent: "#5f5c58",
  step: "#a9a49e",
  chat: "#2f6db5",
  execute_tool: "#1f7a4d",
  pause: "#cfcbc6",
};
const ERROR_COLOR = "#d0102c";

interface Props {
  rows: Row[];
  /** Length of the time axis in ms. */
  totalMs: number;
  /** Where open spans end on the axis (now for live runs, the playhead during playback). */
  openEndMs: number;
  selectedId?: string;
  onSelect: (id: string) => void;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

function ticks(totalMs: number): number[] {
  if (totalMs <= 0) return [0];
  const raw = totalMs / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = 0; t <= totalMs + 1e-9; t += step) out.push(t);
  return out;
}

/**
 * Waterfall timeline. Rows are virtualized DOM (labels, tree semantics, keyboard
 * navigation); bars for the visible window are drawn on one canvas.
 */
export function Timeline({ rows, totalMs, openEndMs, selectedId, onSelect, collapsed, onToggle }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const scrollOffset = virtualizer.scrollOffset ?? 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const labelW = Math.round(size.w * LABEL_FRACTION);
  const barW = Math.max(1, size.w - labelW - 16);
  const x = useCallback((ms: number) => labelW + 8 + (totalMs > 0 ? (ms / totalMs) * barW : 0), [labelW, barW, totalMs]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    // Grid lines at the tick positions.
    ctx.strokeStyle = "#eeece9";
    ctx.lineWidth = 1;
    for (const t of ticks(totalMs)) {
      const gx = Math.round(x(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, size.h);
      ctx.stroke();
    }
    for (const item of items) {
      const row = rows[item.index];
      if (!row) continue;
      const y = item.start - scrollOffset;
      if (y + ROW_H < 0 || y > size.h) continue;
      const end = row.endMs ?? Math.max(row.startMs, openEndMs);
      const x0 = x(row.startMs);
      const w = Math.max(2, x(end) - x0);
      ctx.globalAlpha = row.context ? 0.35 : 1;
      ctx.fillStyle = row.isError ? ERROR_COLOR : (OP_COLORS[row.op] ?? "#8a8580");
      ctx.fillRect(x0, y + 8, w, ROW_H - 16);
      if (row.endMs === null) {
        // Open span: a hatched tail shows it is still running.
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        for (let hx = x0 + w - 12; hx < x0 + w; hx += 4) ctx.fillRect(Math.max(x0, hx), y + 8, 2, ROW_H - 16);
      }
      if (row.id === selectedId) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#1a1816";
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 - 1, y + 7, w + 2, ROW_H - 14);
      }
    }
    ctx.globalAlpha = 1;
  }, [items, rows, size, scrollOffset, x, totalMs, openEndMs, selectedId]);

  const selectedIndex = rows.findIndex((r) => r.id === selectedId);
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    const i = selectedIndex < 0 ? 0 : selectedIndex;
    const row = rows[i];
    const go = (j: number) => {
      e.preventDefault();
      onSelect(rows[Math.max(0, Math.min(rows.length - 1, j))].id);
    };
    switch (e.key) {
      case "ArrowDown":
        return go(selectedIndex < 0 ? 0 : i + 1);
      case "ArrowUp":
        return go(i - 1);
      case "Home":
        return go(0);
      case "End":
        return go(rows.length - 1);
      case "ArrowRight":
        e.preventDefault();
        if (row.childCount > 0 && collapsed.has(row.id)) onToggle(row.id);
        else if (rows[i + 1]?.parentId === row.id) onSelect(rows[i + 1].id);
        return;
      case "ArrowLeft": {
        e.preventDefault();
        if (row.childCount > 0 && !collapsed.has(row.id)) onToggle(row.id);
        else if (row.parentId && rows.some((r) => r.id === row.parentId)) onSelect(row.parentId);
        return;
      }
    }
  };

  return (
    <div className="atv-timeline">
      <div className="atv-axis" aria-hidden="true">
        <span className="atv-axis-label" style={{ width: labelW }}>Span</span>
        {ticks(totalMs).map((t) => (
          <span key={t} className="atv-tick" style={{ left: x(t) }}>
            {formatMs(t)}
          </span>
        ))}
      </div>
      <div className="atv-timeline-body">
        <canvas ref={canvasRef} className="atv-canvas" style={{ width: size.w, height: size.h }} aria-hidden="true" />
        <div
          ref={scrollRef}
          className="atv-scroll"
          role="tree"
          aria-label="Spans"
          aria-activedescendant={selectedId ? `atv-row-${selectedId}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {items.map((item) => {
              const row = rows[item.index];
              const open = row.childCount > 0 && !collapsed.has(row.id);
              const dur = row.endMs === null ? "running" : formatMs(row.endMs - row.startMs);
              return (
                <div
                  key={row.id}
                  id={`atv-row-${row.id}`}
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-selected={row.id === selectedId}
                  aria-expanded={row.childCount > 0 ? open : undefined}
                  className={`atv-row${row.id === selectedId ? " is-selected" : ""}${row.context ? " is-context" : ""}`}
                  style={{ transform: `translateY(${item.start}px)`, height: ROW_H }}
                  onClick={() => onSelect(row.id)}
                  data-span-name={row.span.name}
                >
                  <span className="atv-row-label" style={{ width: labelW, paddingLeft: 6 + row.depth * 14 }}>
                    {row.childCount > 0 ? (
                      <button
                        type="button"
                        className="atv-twisty"
                        tabIndex={-1}
                        aria-label={open ? "Collapse" : "Expand"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggle(row.id);
                        }}
                      >
                        {open ? "▾" : "▸"}
                      </button>
                    ) : (
                      <span className="atv-twisty" aria-hidden="true" />
                    )}
                    {row.isError && <span className="atv-icon atv-icon-error" title="Error">✕</span>}
                    {row.endMs === null && <span className="atv-icon atv-icon-open" title="Running">●</span>}
                    <span className="atv-row-name">{row.span.name}</span>
                    {row.fault && <span className="atv-badge-fault" title={`Injected fault: ${row.fault}`}>fault</span>}
                  </span>
                  <span className="atv-sr">
                    {dur}
                    {row.isError ? ", error" : ""}
                    {row.fault ? `, injected fault ${row.fault}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
