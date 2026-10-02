"use client";

import { motion } from "motion/react";
import type { QuizQuestion } from "@/lib/data";
import { fadeUp } from "@/lib/motion";

/** Figma: the inline truth table under a quiz prompt. */
export function TruthTable({ table }: { table: NonNullable<QuizQuestion["table"]> }) {
  return (
    <motion.div variants={fadeUp} className="inline-block overflow-hidden rounded-[14px] border-2 border-alice-deep bg-parchment lip-3 lip-alice">
      <table className="border-collapse text-center text-[16px] font-bold text-prussian">
        <thead>
          <tr className="bg-alice text-wisteria-deep">
            {table.headers.map((h) => (
              <th key={h} className="w-[96px] py-[10px] font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className={i > 0 ? "border-t border-alice" : ""}>
              {r.cells.map((c, j) => (
                <td key={j} className="py-[9px]">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </motion.div>
  );
}
