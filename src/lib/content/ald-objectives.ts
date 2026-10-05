/**
 * ALD objectives ("can do X") and which built-in question tests each one.
 * Drafted from docs/OBJECTIVES-ALD.md, limited to objectives the current bank
 * has questions for; the rest arrive with generation and drills (Phases 2 and 6).
 */
import type { ObjectiveInfo } from "../mastery/types.ts";

interface Row {
  topicId: string;
  slug: string;
  name: string;
  /** 1-based positions in the topic's questions array. */
  questions: number[];
}

const ROWS: Row[] = [
  { topicId: "logic-circuits-switches", slug: "switch-networks", name: "Translate a series/parallel switch network to its Boolean function and back", questions: [1, 3, 4, 5] },
  { topicId: "logic-circuits-switches", slug: "why-binary", name: "Explain why digital systems use binary logic", questions: [2] },

  { topicId: "boolean-algebra", slug: "simplify", name: "Simplify an expression with absorption, combining and the other theorems", questions: [1, 2, 3] },
  { topicId: "boolean-algebra", slug: "dual", name: "State the dual of an identity", questions: [4] },
  { topicId: "boolean-algebra", slug: "precedence", name: "Apply operator precedence (NOT, AND, OR) to read an expression", questions: [5] },
  { topicId: "boolean-algebra", slug: "cost", name: "Explain what simplifying buys a designer", questions: [6] },

  { topicId: "sop-and-pos", slug: "canonical-forms", name: "Write canonical sum-of-products and product-of-sums forms from a truth table", questions: [1, 2, 3, 4] },

  { topicId: "nand-nor-demorgan", slug: "cmos", name: "Explain why NAND and NOR are preferred in CMOS", questions: [1] },
  { topicId: "nand-nor-demorgan", slug: "demorgan", name: "Apply DeMorgan's theorem to complement an expression", questions: [2, 4] },
  { topicId: "nand-nor-demorgan", slug: "nand-nor-networks", name: "Realise two-level networks with only NAND or only NOR gates", questions: [3] },

  { topicId: "karnaugh-maps", slug: "adjacency", name: "Place minterms on a K-map using Gray-code order and wrap-around adjacency", questions: [1, 2] },
  { topicId: "karnaugh-maps", slug: "dont-cares", name: "Use don't-cares to enlarge groups", questions: [3] },
  { topicId: "karnaugh-maps", slug: "grouping", name: "Cover 1s with valid groups and the fewest product terms", questions: [4] },

  { topicId: "binary-and-twos-complement", slug: "convert", name: "Convert between decimal and n-bit 2's complement, and compare with sign-and-magnitude", questions: [1, 2, 6] },
  { topicId: "binary-and-twos-complement", slug: "add-sub-overflow", name: "Add and subtract in 2's complement and decide whether overflow occurred", questions: [3, 4] },
  { topicId: "binary-and-twos-complement", slug: "sign-extend", name: "Sign-extend a 2's complement number when widening", questions: [5] },

  { topicId: "fixed-and-floating-point", slug: "q-format", name: "Read a Qi.f fixed-point pattern and say where the radix point lives", questions: [1, 2] },
  { topicId: "fixed-and-floating-point", slug: "choose-format", name: "Choose a fixed-point format for a required range and precision", questions: [3] },
  { topicId: "fixed-and-floating-point", slug: "fixed-multiply", name: "Predict precision loss and overflow in a fixed-point multiply", questions: [4] },
  { topicId: "fixed-and-floating-point", slug: "float-decode", name: "Decode a float's biased exponent", questions: [5] },
  { topicId: "fixed-and-floating-point", slug: "float-special", name: "Recognise special floating-point values such as ±0", questions: [6] },

  { topicId: "adders", slug: "full-adder", name: "Compute the sum and carry of a full adder", questions: [1] },
  { topicId: "adders", slug: "ripple-delay", name: "Find the worst case and estimate the delay of a ripple-carry adder", questions: [2, 3] },
  { topicId: "adders", slug: "carry-lookahead", name: "Write lookahead carries from generate and propagate, and explain hierarchical CLA", questions: [4, 5, 6] },

  { topicId: "multipliers", slug: "product-width", name: "Determine product width and which bits a constant-width result keeps", questions: [1] },
  { topicId: "multipliers", slug: "array-critical-path", name: "Compare carry-ripple and carry-save array multipliers", questions: [2, 3] },
  { topicId: "multipliers", slug: "signed-multiply", name: "Handle signs in a 2's complement array multiply", questions: [4, 5] },

  { topicId: "booth-recoding", slug: "count-partial-products", name: "Count partial products with and without Booth recoding", questions: [1, 3] },
  { topicId: "booth-recoding", slug: "recode", name: "Recode a multiplier with radix-4 Booth: pad, group, look up", questions: [2, 4] },
  { topicId: "booth-recoding", slug: "trade-offs", name: "Explain what Booth recoding speeds up and why radix-8 is rarely used", questions: [5, 6] },

  { topicId: "verilog-basics", slug: "literals-values", name: "Read sized literals and Verilog's four signal values", questions: [1, 2] },
  { topicId: "verilog-basics", slug: "declarations", name: "Read and write net, variable and array declarations and legal identifiers", questions: [3, 4, 6] },
  { topicId: "verilog-basics", slug: "tristate", name: "Describe a tri-state buffer with the conditional operator", questions: [5] },

  { topicId: "behavioral-verilog", slug: "loops-generate", name: "Explain what a for loop unrolls into and when generate is required", questions: [1, 2] },
  { topicId: "behavioral-verilog", slug: "always-blocks", name: "Declare the outputs of an always block correctly", questions: [3] },
  { topicId: "behavioral-verilog", slug: "tasks-functions", name: "Decide between a task and a function", questions: [4] },
  { topicId: "behavioral-verilog", slug: "mux-styles", name: "Describe a multiplexer with conditional expressions", questions: [5] },

  { topicId: "verilog-pitfalls-testbenches", slug: "pitfalls", name: "Spot the classic mistakes: blocking assignment, multiple drivers, net vs variable, replication", questions: [1, 3, 4, 6] },
  { topicId: "verilog-pitfalls-testbenches", slug: "parameters", name: "Instantiate a parameterised module per instance", questions: [2] },
  { topicId: "verilog-pitfalls-testbenches", slug: "testbenches", name: "Read a testbench: stimulus timing and ending the simulation", questions: [5] },
];

function build(rows: readonly Row[]) {
  const objectives: Record<string, ObjectiveInfo> = {};
  const byQuestion: Record<string, string> = {};
  for (const row of rows) {
    const id = `${row.topicId}/${row.slug}`;
    if (objectives[id]) throw new Error(`Duplicate objective ${id}`);
    objectives[id] = { id, topicId: row.topicId, name: row.name };
    for (const n of row.questions) {
      const questionId = `${row.topicId}-${n}`;
      if (byQuestion[questionId]) throw new Error(`Question ${questionId} is mapped to both ${byQuestion[questionId]} and ${id}`);
      byQuestion[questionId] = id;
    }
  }
  return { objectives, byQuestion };
}

const built = build(ROWS);
export const ALD_OBJECTIVES: Readonly<Record<string, ObjectiveInfo>> = built.objectives;
export const ALD_QUESTION_OBJECTIVE: Readonly<Record<string, string>> = built.byQuestion;
