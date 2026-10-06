"use client";

import { motion } from "motion/react";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { IconCheck } from "@/components/icons";
import { useFitScale } from "@/hooks/useFitScale";
import { ATLAS_CENTRE, ATLAS_H, ATLAS_W, type AtlasConcept, type AtlasLayout, type ConceptMastery } from "@/lib/course/atlas";
import { cn } from "@/lib/cn";

/**
 * Figma: 12 · Concept Atlas (105:47), the canvas: the unit rings with their labels, a slow sonar
 * sweep, the connections, the concept pills with their mastery glyphs, and the orca badge in the
 * middle. Selecting a concept (click, Enter) lifts it and its connections; everything else dims to
 * 30% and nothing is hidden (design spec §1). The sea-life decorations in the mockup (fish,
 * jellyfish, coral, kelp) are vector assets not yet exported from Figma, so they aren't drawn.
 */
export interface ConceptAtlasProps {
  layout: AtlasLayout;
  selected: string | null;
  onSelect: (conceptId: string | null) => void;
}

/** Each unit's ring, outermost first in the stack so inner rings paint on top. */
const RING_FILLS = ["#E7EFFB", "#DCE7F8", "#D2DFF6", "#C8D7F4", "#BFD0F2", "#B6C9F0"];

function Glyph({ mastery, selected }: { mastery: ConceptMastery; selected: boolean }) {
  switch (mastery) {
    case "mastered":
      return (
        <span className={cn("flex h-[20px] w-[20px] items-center justify-center rounded-pill", selected ? "bg-parchment text-wisteria-deep" : "bg-parchment/90 text-wisteria-deep")} aria-hidden>
          <IconCheck size={12} strokeWidth={3.5} />
        </span>
      );
    case "building":
      return <span className="block h-[16px] w-[16px] rounded-pill bg-wisteria" aria-hidden />;
    case "review":
      return <span className="block h-[16px] w-[16px] rounded-pill border-[3px] border-wisteria-deep" aria-hidden />;
    case "not-started":
      return <span className="block h-[14px] w-[14px] rounded-pill border-2 border-alice-deep" aria-hidden />;
  }
}

const PILL: Record<ConceptMastery, string> = {
  mastered: "border-wisteria-deep bg-wisteria text-parchment lip-wisteria",
  building: "border-alice-deep bg-parchment text-prussian lip-alice",
  review: "border-wisteria-deep bg-parchment text-prussian lip-wisteria",
  "not-started": "border-dashed border-periwinkle-deep bg-parchment text-prussian lip-alice",
};

function ConceptPill({ concept, selected, dimmed, related, onSelect }: { concept: AtlasConcept; selected: boolean; dimmed: boolean; related: boolean; onSelect: () => void }) {
  const o = concept.objective;
  return (
    <motion.button
      type="button"
      data-part="concept"
      data-concept={o.id}
      data-mastery={concept.mastery}
      aria-pressed={selected}
      aria-label={`${o.name}, ${concept.mastery.replace("-", " ")}, unit ${concept.unit}`}
      onClick={onSelect}
      initial={false}
      animate={{ opacity: dimmed ? 0.3 : 1, scale: selected ? 1.18 : 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className={cn(
        "pressable absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-[8px] whitespace-nowrap rounded-pill border-2 py-[7px] pl-[11px] pr-[14px] text-[14px] font-bold lip-3",
        PILL[concept.mastery],
        selected && "z-20 ring-[6px] ring-periwinkle/60",
        related && !selected && "z-10",
      )}
      style={{ left: concept.x, top: concept.y }}
    >
      <Glyph mastery={concept.mastery} selected={selected} />
      {o.name}
    </motion.button>
  );
}

/** A connection curves a little toward the middle, so links on the same ring don't cross the pills. */
function linkPath(a: AtlasConcept, b: AtlasConcept): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = mx + (ATLAS_CENTRE.x - mx) * 0.25;
  const cy = my + (ATLAS_CENTRE.y - my) * 0.25;
  return `M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`;
}

export function ConceptAtlas({ layout, selected, onSelect }: ConceptAtlasProps) {
  const { ref, scale, x, y } = useFitScale(ATLAS_W, ATLAS_H, "contain");
  const byId = new Map(layout.concepts.map((c) => [c.objective.id, c]));
  const related = new Set<string>();
  if (selected) for (const l of layout.links) if (l.from === selected) related.add(l.to); else if (l.to === selected) related.add(l.from);
  const rings = [...layout.units].reverse();

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden" data-part="concept-atlas" onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
      <div className="absolute origin-top-left" style={{ left: x, top: y, width: ATLAS_W, height: ATLAS_H, transform: `scale(${scale})` }}>
        <svg className="absolute inset-0" width={ATLAS_W} height={ATLAS_H} viewBox={`0 0 ${ATLAS_W} ${ATLAS_H}`} aria-hidden onClick={() => onSelect(null)}>
          <defs>
            <clipPath id="atlas-rings-clip">
              {layout.units.length > 0 && <circle cx={ATLAS_CENTRE.x} cy={ATLAS_CENTRE.y} r={layout.units[layout.units.length - 1].radius} />}
            </clipPath>
          </defs>
          {rings.map((u, i) => (
            <circle key={u.topic.id} data-part="ring" cx={ATLAS_CENTRE.x} cy={ATLAS_CENTRE.y} r={u.radius} fill={RING_FILLS[Math.min(i, RING_FILLS.length - 1)]} stroke="var(--color-periwinkle-deep)" strokeWidth={2} strokeDasharray="6 7" />
          ))}
          {layout.units.length > 0 && (
            <motion.path
              data-part="sonar"
              d={`M${ATLAS_CENTRE.x} ${ATLAS_CENTRE.y} L${ATLAS_CENTRE.x} ${ATLAS_CENTRE.y - RING_MAX_SWEEP} A${RING_MAX_SWEEP} ${RING_MAX_SWEEP} 0 0 1 ${ATLAS_CENTRE.x + RING_MAX_SWEEP * Math.sin(0.9)} ${ATLAS_CENTRE.y - RING_MAX_SWEEP * Math.cos(0.9)} Z`}
              fill="var(--color-wisteria)"
              opacity={0.12}
              clipPath="url(#atlas-rings-clip)"
              style={{ transformOrigin: `${ATLAS_CENTRE.x}px ${ATLAS_CENTRE.y}px` }}
              animate={{ rotate: 360 }}
              transition={{ duration: 36, ease: "linear", repeat: Infinity }}
            />
          )}
          {layout.links.map((l) => {
            const a = byId.get(l.from)!;
            const b = byId.get(l.to)!;
            const lit = selected !== null && (l.from === selected || l.to === selected);
            const dim = selected !== null && !lit;
            return (
              <path
                key={l.id}
                data-part="link"
                data-kind={l.kind}
                d={linkPath(a, b)}
                fill="none"
                stroke={lit ? "var(--color-wisteria-deep)" : "var(--color-periwinkle-deep)"}
                strokeWidth={lit ? 3.5 : 2.5}
                strokeLinecap="round"
                strokeDasharray={l.kind === "related" ? "2 8" : undefined}
                opacity={dim ? 0.3 : 1}
              />
            );
          })}
          <circle cx={ATLAS_CENTRE.x} cy={ATLAS_CENTRE.y} r={78} fill="var(--color-alice)" opacity={0.9} />
          <circle cx={ATLAS_CENTRE.x} cy={ATLAS_CENTRE.y} r={48} fill="var(--color-parchment)" stroke="var(--color-alice-deep)" strokeWidth={3} />
        </svg>

        {layout.units.map((u) => (
          <span
            key={u.topic.id}
            data-part="unit-label"
            title={u.topic.name}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-alice-deep bg-parchment px-[12px] py-[5px] text-[12px] font-semibold uppercase tracking-[1.2px] text-wisteria-deep"
            style={{ left: ATLAS_CENTRE.x - u.radius, top: ATLAS_CENTRE.y }}
          >
            Unit {u.index}
          </span>
        ))}

        <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: ATLAS_CENTRE.x + 4, top: ATLAS_CENTRE.y + 2 }} aria-hidden>
          <OrcaLogo waves shadow={false} width={70} swim />
        </div>

        {layout.concepts.map((c) => (
          <ConceptPill
            key={c.objective.id}
            concept={c}
            selected={selected === c.objective.id}
            related={related.has(c.objective.id)}
            dimmed={selected !== null && selected !== c.objective.id && !related.has(c.objective.id)}
            onSelect={() => onSelect(selected === c.objective.id ? null : c.objective.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** The sweep reaches the outermost ring. */
const RING_MAX_SWEEP = 345;
