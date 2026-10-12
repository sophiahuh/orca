"use client";

import { useState } from "react";
import { type Weights, weightLabel, weightPercents } from "@/lib/data";
import { IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Slider } from "@/components/ui/Slider";

/**
 * The material-type sliders (what Orca prioritizes when it builds reviews), for a course or for
 * Settings' defaults. While a slider is dragged the screen follows a draft; `onChange` gets the
 * value once, when the student lets go.
 */
export function WeightsEditor({ weights, onChange }: { weights: Weights; onChange: (w: Weights) => void }) {
  const [draft, setDraft] = useState<Weights | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState("");
  const w = draft ?? weights;
  const pct = weightPercents(w);

  const commit = (key: string, v: number) => {
    setDraft(null);
    if (weights[key] !== v) onChange({ ...weights, [key]: v });
  };
  const addType = () => {
    const name = newType.trim();
    if (!name) return;
    onChange({ ...weights, [name]: 10 });
    setNewType("");
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-[14px]">
      {Object.entries(w).map(([key, value]) => (
        <div key={key} className="flex items-center gap-[14px]">
          <span className="w-[128px] shrink-0 truncate text-[14px] font-bold text-prussian">{weightLabel(key)}</span>
          <Slider label={`${weightLabel(key)} weight`} value={value} onChange={(v) => setDraft({ ...w, [key]: v })} onCommit={(v) => commit(key, v)} className="flex-1" />
          <span className="w-[40px] text-right text-[14px] font-semibold text-wisteria-deep">{pct[key]}%</span>
        </div>
      ))}

      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addType();
          }}
          className="flex items-center gap-[10px]"
        >
          <input
            autoFocus
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            placeholder="e.g. Lab reports"
            aria-label="New material type"
            className="h-[40px] min-w-0 flex-1 rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[12px] text-[15px] font-bold text-prussian placeholder:font-medium placeholder:text-periwinkle-deep focus:outline-none"
          />
          <Button size="sm" type="submit" disabled={!newType.trim()}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="ghost" size="sm" icon={<IconPlus size={18} />} className="self-start" onClick={() => setAdding(true)}>
          Add material type
        </Button>
      )}
    </div>
  );
}
