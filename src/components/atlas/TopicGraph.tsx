"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import type { RelationType } from "@/lib/data";
import { type GraphNode, RELATION_LABEL, STRENGTH_LABEL, type TopicGraph as Graph, type TopicStrength, topicSummary } from "@/lib/course/topic-graph";
import { popIn, stagger } from "@/lib/motion";

/**
 * Figma: E1 · Concept graph v4 (foundations on top) and E2 (hover on a topic). The topics as nodes,
 * sized by how many topics they're used in, with their strength glyph and name; the relations as
 * edges in four styles. Hovering (or focusing) a topic dims the rest to 30%, labels its edges and
 * shows a tooltip; clicking opens the topic's quiz. Zoom with − + and fit; drag to pan.
 */
const EDGE: Record<RelationType, { stroke: string; dash?: string; width: number; marker?: string }> = {
  "used-in": { stroke: "var(--color-wisteria-deep)", width: 2.5, marker: "url(#arrow-used)" },
  "has-a-kind": { stroke: "var(--color-link-kind)", dash: "6 5", width: 2, marker: "url(#arrow-kind)" },
  "alternative-to": { stroke: "var(--color-link-alt)", dash: "2 5", width: 2.5 },
  related: { stroke: "var(--color-link-related)", width: 1.5 },
};

const NODE: Record<TopicStrength, { fill: string; stroke: string; dash?: string; glyph: string }> = {
  strong: { fill: "var(--color-good-tint)", stroke: "var(--color-good)", glyph: "var(--color-good-deep)" },
  developing: { fill: "var(--color-warn-tint)", stroke: "var(--color-warn)", glyph: "var(--color-warn-deep)" },
  fragile: { fill: "var(--color-bad-tint)", stroke: "var(--color-bad)", glyph: "var(--color-bad-deep)" },
  unverified: { fill: "var(--color-parchment)", stroke: "var(--color-periwinkle-deep)", dash: "4 4", glyph: "none" },
};

/** The strength glyph, drawn at the node's centre for radius `r`. */
function Glyph({ strength, r }: { strength: TopicStrength; r: number }) {
  const s = r * 0.42;
  const stroke = NODE[strength].glyph;
  const common = { fill: "none", stroke, strokeWidth: Math.max(2.5, r / 7), strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (strength) {
    case "strong":
      return <path d={`M${-s} 0 L${-s / 3} ${s * 0.7} L${s} ${-s * 0.6}`} {...common} />;
    case "developing":
      return <path d={`M${-s * 0.8} ${s * 0.35} L0 ${-s * 0.45} L${s * 0.8} ${s * 0.35}`} {...common} />;
    case "fragile":
      return (
        <g>
          <path d={`M0 ${-s * 0.8} L0 ${s * 0.2}`} {...common} />
          <circle cx={0} cy={s * 0.75} r={common.strokeWidth * 0.6} fill={stroke} />
        </g>
      );
    case "unverified":
      return null;
  }
}

type View = { x: number; y: number; w: number; h: number };

export function TopicGraph({ graph, onOpen }: { graph: Graph; onOpen: (topicId: string) => void }) {
  const full = useMemo<View>(() => ({ x: 0, y: 0, w: graph.width, h: graph.height }), [graph.width, graph.height]);
  // Starts fitted; the page remounts this (key) when the graph's size changes.
  const [view, setView] = useState<View>(full);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const zoom = useCallback(
    (factor: number) =>
      setView((v) => {
        const w = Math.min(full.w * 1.5, Math.max(full.w / 4, v.w * factor));
        const h = (w / v.w) * v.h;
        return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
      }),
    [full.w],
  );

  const neighbours = useMemo(() => {
    if (!hover) return null;
    const ids = new Set([hover]);
    for (const e of graph.edges) {
      if (e.from === hover) ids.add(e.to);
      if (e.to === hover) ids.add(e.from);
    }
    return ids;
  }, [hover, graph.edges]);
  const lit = (e: { from: string; to: string }) => hover !== null && (e.from === hover || e.to === hover);
  const hovered = hover ? graph.nodes.find((n) => n.topic.id === hover) ?? null : null;

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget) return;
    drag.current = { x: e.clientX, y: e.clientY, view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const svg = svgRef.current;
    if (!d || !svg) return;
    const box = svg.getBoundingClientRect();
    // preserveAspectRatio "meet": one screen pixel is the larger of the two ratios in view units.
    const k = Math.max(d.view.w / box.width, d.view.h / box.height);
    setView({ ...d.view, x: d.view.x - (e.clientX - d.x) * k, y: d.view.y - (e.clientY - d.y) * k });
  };
  const endDrag = () => (drag.current = null);

  return (
    <div className="absolute inset-0" data-part="topic-graph">
      <svg
        ref={svgRef}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="Topic map"
        role="group"
      >
        <defs>
          <marker id="arrow-used" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--color-wisteria-deep)" />
          </marker>
          <marker id="arrow-kind" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M1 1 L9 5 L1 9 z" fill="var(--color-parchment)" stroke="var(--color-link-kind)" strokeWidth="1.6" strokeLinejoin="round" />
          </marker>
        </defs>

        {graph.edges.map((e) => {
          const style = EDGE[e.type];
          const on = lit(e);
          return (
            <path
              key={e.id}
              data-part="edge"
              data-type={e.type}
              d={e.d}
              fill="none"
              stroke={style.stroke}
              strokeWidth={on ? style.width + 0.8 : style.width}
              strokeDasharray={style.dash}
              strokeLinecap="round"
              markerEnd={style.marker}
              opacity={hover && !on ? 0.25 : 1}
              pointerEvents="none"
            />
          );
        })}

        <motion.g variants={stagger(0.05, 0.03)} initial="hidden" animate="show">
          {graph.nodes.map((n) => (
            <TopicNode key={n.topic.id} node={n} active={hover === n.topic.id} dim={neighbours !== null && !neighbours.has(n.topic.id)} onHover={setHover} onOpen={onOpen} />
          ))}
        </motion.g>

        {/* Hover: the lit edges' kinds as pills (related edges stay unlabelled). */}
        {graph.edges.filter((e) => lit(e) && e.type !== "related").map((e) => {
          const label = RELATION_LABEL[e.type];
          const w = label.length * 6.4 + 18;
          return (
            <g key={`label-${e.id}`} transform={`translate(${e.mid.x} ${e.mid.y})`} pointerEvents="none" data-part="edge-label">
              <rect x={-w / 2} y={-10} width={w} height={20} rx={10} fill="var(--color-parchment)" stroke={EDGE[e.type].stroke} strokeWidth={1.5} />
              <text textAnchor="middle" y={4} fontSize={11} fontWeight={700} fill={EDGE[e.type].stroke}>
                {label}
              </text>
            </g>
          );
        })}

        {hovered && <Tooltip node={hovered} />}
      </svg>

      <div className="absolute bottom-[20px] left-[20px] right-[20px] flex items-end justify-between gap-[12px]">
        <Legend />
        <div className="flex gap-[8px]" role="group" aria-label="Zoom">
          <ZoomButton label="Zoom out" onClick={() => zoom(1.25)}>
            −
          </ZoomButton>
          <ZoomButton label="Zoom in" onClick={() => zoom(0.8)}>
            +
          </ZoomButton>
          <ZoomButton label="Fit to screen" onClick={() => setView(full)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
            </svg>
          </ZoomButton>
        </div>
      </div>
    </div>
  );
}

function TopicNode({ node: n, active, dim, onHover, onOpen }: { node: GraphNode; active: boolean; dim: boolean; onHover: (id: string | null) => void; onOpen: (id: string) => void }) {
  const style = NODE[n.strength];
  const id = n.topic.id;
  return (
    <motion.g
      variants={popIn}
      data-part="topic"
      data-topic={id}
      data-strength={n.strength}
      role="button"
      tabIndex={0}
      aria-label={`${n.topic.name}, ${STRENGTH_LABEL[n.strength]}: ${topicSummary(n)}`}
      className="cursor-pointer outline-none"
      style={{ opacity: dim ? 0.3 : 1, transition: "opacity 150ms" }}
      onPointerEnter={() => onHover(id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(id)}
      onBlur={() => onHover(null)}
      onClick={() => onOpen(id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(id))}
    >
      <g transform={`translate(${n.x} ${n.y})`}>
        {n.usedIn > 0 && <circle r={n.r + 5} fill={style.fill} opacity={0.6} />}
        {active && <circle r={n.r + 4} fill="none" stroke="var(--color-wisteria-deep)" strokeWidth={2} data-part="topic-ring" />}
        <circle r={n.r} fill={style.fill} stroke={style.stroke} strokeWidth={2.5} strokeDasharray={style.dash} />
        <Glyph strength={n.strength} r={n.r} />
        <text y={n.r + (n.usedIn > 0 ? 22 : 17)} textAnchor="middle" fontSize={n.usedIn > 0 ? 13 : 12} fontWeight={n.usedIn > 0 ? 700 : 600} fill="var(--color-prussian)">
          {n.topic.name}
        </text>
      </g>
    </motion.g>
  );
}

function Tooltip({ node: n }: { node: GraphNode }) {
  const title = `${n.topic.name} · ${STRENGTH_LABEL[n.strength]}`;
  const detail = topicSummary(n);
  const w = Math.max(title.length * 7, detail.length * 5.6) + 24;
  return (
    <g transform={`translate(${n.x + n.r + 10} ${n.y + 4})`} pointerEvents="none" data-part="topic-tooltip">
      <rect width={w} height={42} rx={8} fill="var(--color-prussian)" />
      <text x={12} y={17} fontSize={12} fontWeight={700} fill="var(--color-parchment)">
        {title}
      </text>
      <text x={12} y={33} fontSize={10.5} fill="var(--color-alice)">
        {detail}
      </text>
    </g>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="pressable inline-flex h-[36px] w-[36px] items-center justify-center rounded-[10px] border-2 border-alice-deep bg-parchment text-[18px] font-bold text-prussian lip-2 lip-alice">
      {children}
    </button>
  );
}

const STRENGTH_ORDER: TopicStrength[] = ["strong", "developing", "fragile", "unverified"];

function Legend() {
  const line = (type: RelationType) => {
    const s = EDGE[type];
    return (
      <svg width="30" height="10" aria-hidden>
        <path d="M1 5 H22" stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" />
        {type === "used-in" && <path d="M22 1 L29 5 L22 9 z" fill={s.stroke} />}
        {type === "has-a-kind" && <path d="M22 1.5 L28.5 5 L22 8.5 z" fill="var(--color-parchment)" stroke={s.stroke} strokeWidth={1.3} />}
      </svg>
    );
  };
  return (
    <div className="flex flex-col gap-[6px] rounded-[16px] border-2 border-alice-deep bg-parchment px-[14px] py-[10px] text-[12px] font-semibold text-prussian lip-3 lip-alice" data-part="graph-legend">
      <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[4px]">
        {(["used-in", "has-a-kind", "alternative-to", "related"] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-[6px]">
            {line(t)}
            {RELATION_LABEL[t]}
          </span>
        ))}
        <span className="inline-flex items-center gap-[4px]">
          <svg width="26" height="14" aria-hidden>
            <circle cx="6" cy="7" r="4" fill="none" stroke="var(--color-periwinkle-deep)" strokeWidth="1.5" />
            <circle cx="18" cy="7" r="6" fill="none" stroke="var(--color-periwinkle-deep)" strokeWidth="1.5" />
          </svg>
          bigger = more build on it
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[4px]">
        {STRENGTH_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-[5px]">
            <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden>
              <circle r={6.5} fill={NODE[s].fill} stroke={NODE[s].stroke} strokeWidth={1.5} strokeDasharray={s === "unverified" ? "2 2" : undefined} />
              <g transform="scale(0.55)">
                <Glyph strength={s} r={11} />
              </g>
            </svg>
            {STRENGTH_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

