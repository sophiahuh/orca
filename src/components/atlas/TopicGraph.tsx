"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import type { RelationType } from "@/lib/data";
import { edgePath, GRAPH, type GraphNode, RELATION_LABEL, STRENGTH_LABEL, type TopicGraph as Graph, type TopicStrength, topicSummary, wrapLabel } from "@/lib/course/topic-graph";
import { popIn, stagger } from "@/lib/motion";

/**
 * Figma: E1 · Concept graph v4 (foundations on top) and E2 (hover on a topic). The topics as nodes,
 * sized by how many topics they're used in, with their strength glyph and name; the relations as
 * edges in four styles. Hovering (or focusing) a topic dims the rest to 30%, labels its edges and
 * shows a tooltip; clicking opens the topic's quiz. Zoom with − + and fit; drag open space to pan
 * or drag a node to arrange it. Long names
 * wrap (at most three lines) and edges leave from under a topic's name.
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

const LABEL_T = [0.75, 0.58, 0.9, 0.42, 0.26, 0.98, 0.1] as const;
const LABEL_GAP = 12;

function labelOverlap(a: { x: number; y: number; w: number }, b: { x: number; y: number; w: number }) {
  const x = Math.max(0, (a.w + b.w) / 2 + LABEL_GAP - Math.abs(a.x - b.x));
  const y = Math.max(0, 20 + LABEL_GAP - Math.abs(a.y - b.y));
  return x * y;
}

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
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [hover, setHover] = useState<string | null>(null);
  const panDrag = useRef<{ x: number; y: number; view: View } | null>(null);
  const nodeDrag = useRef<{ id: string; x: number; y: number; startX: number; startY: number; view: View; moved: boolean } | null>(null);
  const ignoreClick = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const nodes = useMemo(() => graph.nodes.map((node) => ({ ...node, ...positions[node.topic.id] })), [graph.nodes, positions]);
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.topic.id, node])), [nodes]);
  const edges = useMemo(() => graph.edges.map((edge) => ({ ...edge, ...edgePath(nodesById.get(edge.from)!, nodesById.get(edge.to)!) })), [graph.edges, nodesById]);

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
  // Label positions stay exactly on their arrows. Each starts in the normal position; only labels
  // whose padded bounds collide slide to another point on their own path.
  const edgeLabels = useMemo(() => {
    const shown = edges
      .filter((edge) => hover !== null && (edge.from === hover || edge.to === hover) && edge.type !== "related")
      .sort((a, b) => RELATION_LABEL[b.type].length - RELATION_LABEL[a.type].length);
    const placed: Array<{ x: number; y: number; w: number }> = [];
    return shown.map((edge) => {
      const w = RELATION_LABEL[edge.type].length * 6.4 + 18;
      const candidates = LABEL_T.map((t) => edgePath(nodesById.get(edge.from)!, nodesById.get(edge.to)!, t).mid);
      const label = candidates
        .map((candidate) => ({ candidate, overlap: placed.reduce((total, other) => total + labelOverlap({ ...candidate, w }, other), 0) }))
        .sort((a, b) => a.overlap - b.overlap)[0]!.candidate;
      placed.push({ ...label, w });
      return { ...edge, label };
    });
  }, [edges, hover, nodesById]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget) return;
    panDrag.current = { x: e.clientX, y: e.clientY, view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const node = nodeDrag.current;
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    if (node) {
      const k = Math.max(node.view.w / box.width, node.view.h / box.height);
      const dx = (e.clientX - node.startX) * k;
      const dy = (e.clientY - node.startY) * k;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) node.moved = true;
      setPositions((p) => ({ ...p, [node.id]: { x: node.x + dx, y: node.y + dy } }));
      return;
    }
    const d = panDrag.current;
    if (!d) return;
    // preserveAspectRatio "meet": one screen pixel is the larger of the two ratios in view units.
    const k = Math.max(d.view.w / box.width, d.view.h / box.height);
    setView({ ...d.view, x: d.view.x - (e.clientX - d.x) * k, y: d.view.y - (e.clientY - d.y) * k });
  };
  const endDrag = () => {
    if (nodeDrag.current?.moved) {
      ignoreClick.current = true;
      requestAnimationFrame(() => (ignoreClick.current = false));
    }
    nodeDrag.current = null;
    panDrag.current = null;
  };
  const startNodeDrag = (node: GraphNode, e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    nodeDrag.current = { id: node.topic.id, x: node.x, y: node.y, startX: e.clientX, startY: e.clientY, view, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const openNode = (id: string) => {
    if (ignoreClick.current) return;
    onOpen(id);
  };

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

        {edges.map((e) => {
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
          {nodes.map((n) => (
            <TopicNode key={n.topic.id} node={n} active={hover === n.topic.id} dim={neighbours !== null && !neighbours.has(n.topic.id)} onHover={setHover} onOpen={openNode} onDragStart={startNodeDrag} />
          ))}
        </motion.g>

        {/* Hover: the lit edges' kinds as pills (related edges stay unlabelled). */}
        {edgeLabels.map((e) => {
          const label = RELATION_LABEL[e.type];
          const w = label.length * 6.4 + 18;
          return (
            <g key={`label-${e.id}`} transform={`translate(${e.label.x} ${e.label.y})`} pointerEvents="none" data-part="edge-label">
              <rect x={-w / 2} y={-10} width={w} height={20} rx={10} fill="var(--color-parchment)" stroke={EDGE[e.type].stroke} strokeWidth={1.5} />
              <text textAnchor="middle" y={4} fontSize={11} fontWeight={700} fill={EDGE[e.type].stroke}>
                {label}
              </text>
            </g>
          );
        })}

        {hovered && <Tooltip node={nodesById.get(hovered.topic.id) ?? hovered} />}
      </svg>

      <div className="absolute bottom-[20px] right-[20px]">
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

function TopicNode({ node: n, active, dim, onHover, onOpen, onDragStart }: { node: GraphNode; active: boolean; dim: boolean; onHover: (id: string | null) => void; onOpen: (id: string) => void; onDragStart: (node: GraphNode, event: React.PointerEvent<SVGGElement>) => void }) {
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
      className="cursor-grab outline-none active:cursor-grabbing"
      style={{ opacity: dim ? 0.3 : 1, transition: "opacity 150ms" }}
      onPointerEnter={() => onHover(id)}
      onPointerLeave={() => onHover(null)}
      onPointerDown={(e) => onDragStart(n, e)}
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
        <text textAnchor="middle" fontSize={11} fontWeight={n.usedIn > 0 ? 700 : 600} fill="var(--color-prussian)">
          {n.lines.map((line, i) => (
            <tspan key={i} x={0} y={n.r + GRAPH.labelGap + GRAPH.lineHeight * (i + 1) - 3}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </motion.g>
  );
}

/** At most this wide; its lines wrap to fit (characters per line at each size). */
const TOOLTIP = { width: 210, titleChars: 30, detailChars: 38, pad: 12, titleLine: 15, detailLine: 13 } as const;

function Tooltip({ node: n }: { node: GraphNode }) {
  const title = wrapLabel(`${n.topic.name} · ${STRENGTH_LABEL[n.strength]}`, TOOLTIP.titleChars, 4);
  const detail = wrapLabel(topicSummary(n), TOOLTIP.detailChars, 3);
  const longest = Math.max(...title.map((l) => l.length * 6.8), ...detail.map((l) => l.length * 5.5));
  const w = Math.min(TOOLTIP.width, longest + 2 * TOOLTIP.pad);
  const h = TOOLTIP.pad * 2 + title.length * TOOLTIP.titleLine + detail.length * TOOLTIP.detailLine;
  return (
    <g transform={`translate(${n.x + n.r + 10} ${n.y - 8})`} pointerEvents="none" data-part="topic-tooltip">
      <rect width={w} height={h} rx={8} fill="var(--color-prussian)" />
      <text fontSize={12} fontWeight={700} fill="var(--color-parchment)">
        {title.map((line, i) => (
          <tspan key={i} x={TOOLTIP.pad} y={TOOLTIP.pad + TOOLTIP.titleLine * (i + 1) - 3}>
            {line}
          </tspan>
        ))}
      </text>
      <text fontSize={10.5} fill="var(--color-alice)">
        {detail.map((line, i) => (
          <tspan key={i} x={TOOLTIP.pad} y={TOOLTIP.pad + title.length * TOOLTIP.titleLine + TOOLTIP.detailLine * (i + 1)}>
            {line}
          </tspan>
        ))}
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
