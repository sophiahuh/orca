/**
 * Built-in content for Advanced Logic Design (Columbia ELEN), authored from the
 * first four lecture decks in docs/samples/ald. Every question cites the slide it
 * comes from. This is what a student gets before connecting their own model; the
 * live pipeline (/api/extract) produces the same shape.
 */
import type { QuizQuestion } from "../data";

export interface ContentTopic {
  id: string;
  name: string;
  summary: string;
  source: { filename: string; slideStart: number; slideEnd: number };
  questions: Array<Omit<QuizQuestion, "id" | "topic">>;
}

const L02 = "L02_Combinational.pdf";
const L03 = "L03_Arithmetic.pdf";
const L04 = "L04_Verilog_for_comb_1.pdf";

const MC = "Multiple choice" as const;
const TF = "True or false" as const;
const SA = "Short answer" as const;

export const ALD_TOPICS: ContentTopic[] = [
  /* ───────────── L02 ───────────── */
  {
    id: "logic-circuits-switches",
    name: "Logic Circuits & Switches",
    summary:
      "Binary logic uses only 0 and 1 because it scales robustly in VLSI. Switches in series behave as AND, switches in parallel as OR, and a switch that short-circuits the load gives NOT. A truth table defines a function by listing every input combination.",
    source: { filename: L02, slideStart: 8, slideEnd: 16 },
    questions: [
      {
        kind: MC,
        prompt: "In figure (a), two switches sit in series between the supply and the light. Which function does the light compute?",
        figure: { src: "/figures/ald/l02-s11.png", alt: "Two switch circuits: (a) switches in series, (b) switches in parallel, each driving a light" },
        options: ["OR", "AND", "NOT", "XOR"],
        answer: 1,
        explanation: "Current only flows when both series switches are closed, so the light is on only when x1 AND x2 are 1. Parallel switches give OR.",
        anchor: { locator: "slide 11", excerpt: "The logical AND function (series connection); the logical OR function (parallel connection)" },
      },
      {
        kind: MC,
        prompt: "Why does the course use binary rather than, say, ternary logic?",
        options: ["Ternary logic is impossible to build", "Binary gives robust, scalable VLSI implementations", "Binary needs fewer transistors per gate", "It is just convention"],
        answer: 1,
        explanation: "Other value systems exist (ternary uses −1, 0, +1), but two levels are far more robust and scalable in hardware.",
        anchor: { locator: "slide 8", excerpt: "binary logic has an advantage in robust and scalable VLSI hardware implementation" },
      },
      {
        kind: MC,
        prompt: "In the figure, how does closing switch S turn the light off?",
        figure: { src: "/figures/ald/l02-s13.png", alt: "A power supply feeding a resistor R, then a switch S in parallel with a light" },
        options: ["It disconnects the battery", "It short-circuits the light so current bypasses it", "It reverses the current direction", "It adds resistance in series"],
        answer: 1,
        explanation: "The closed switch provides a path around the light, so no current flows through it: output is the complement of the input.",
        anchor: { locator: "slide 13", excerpt: "The switch will short-circuit the light and prevent the current from flowing through it" },
      },
      {
        kind: TF,
        prompt: "In figure (b), with switches in parallel, the light is off whenever either switch is open.",
        options: ["True", "False"],
        answer: 1,
        explanation: "Parallel switches give OR: one closed path is enough to light the lamp. The light is off only when both are open. 'Either open means off' describes the series (AND) circuit in figure (a).",
        anchor: { locator: "slide 11", excerpt: "L = 1 if x1 = 1 or x2 = 1 or if x1 = x2 = 1; L = 0 if x1 = x2 = 0" },
        figure: { src: "/figures/ald/l02-s11.png", alt: "Two switch circuits: (a) switches in series, (b) switches in parallel, each driving a light" },
      },
      {
        kind: MC,
        prompt: "A light should turn on when switch x3 is closed AND at least one of x1 or x2 is closed. How must the three switches be wired?",
        options: [
          "x1, x2 and x3 all in series",
          "x1, x2 and x3 all in parallel",
          "x1 in parallel with x2, and that pair in series with x3",
          "x1 in series with x2, and that pair in parallel with x3",
        ],
        answer: 2,
        explanation: "Series means AND, parallel means OR, so (x1 OR x2) AND x3 is a parallel pair feeding a series switch. Option D builds (x1 AND x2) OR x3, which lights with x3 alone.",
        anchor: { locator: "slide 17", excerpt: "f = (x1 + x2) × x3" },
      },
    ],
  },
  {
    id: "boolean-algebra",
    name: "Boolean Algebra",
    summary:
      "Boole's 1849 algebra, applied to switching circuits by Shannon in the 1930s, lets you analyse a network (find its function) and synthesise one (build a network for a function). Functionally equivalent networks should be replaced by the cheaper one. Duality, precedence NOT → AND → OR, and Huntington's postulates underpin the identities.",
    source: { filename: L02, slideStart: 17, slideEnd: 24 },
    questions: [
      {
        kind: SA,
        tier: "retrieval",
        prompt: "Simplify x·y + x·y' as far as possible. Type the result.",
        options: [],
        answer: -1,
        exact: ["x"],
        explanation: "Factor x out: x·(y + y') = x·1 = x. This 'combining' step is what a K-map group of two does: the variable that differs disappears.",
        anchor: { locator: "slide 22", excerpt: "Properties table (combining: x·y + x·y' = x)" },
      },
      {
        kind: SA,
        tier: "retrieval",
        prompt: "Apply the absorption property to a + a·b + c. Type the simplest equivalent expression.",
        options: [],
        answer: -1,
        exact: ["a + c", "c + a"],
        explanation: "a + a·b absorbs to a: if a is 1 the whole term is 1, if a is 0 both parts are 0. What remains is a + c.",
        anchor: { locator: "slide 22", excerpt: "Properties table (absorption: x + x·y = x)" },
      },
      {
        kind: SA,
        tier: "mechanism",
        prompt: "x·(x + y) equals x, not x + y. In one sentence, why?",
        options: [],
        answer: -1,
        rubric: {
          requiredIdeas: ["When x = 0 the product is 0 whatever y is, so the result tracks x (and can't be x + y, which is 1 when y = 1)"],
          acceptableAlternatives: ["absorption: x·(x + y) = x", "x AND anything is 0 when x is 0", "the AND with x dominates"],
          knownMisconceptions: [
            { description: "Distributing to x·x + x·y and then dropping the x·x term", indicativePhrasing: ["x·x cancels", "x·x is 0", "so it becomes x·y"] },
          ],
        },
        explanation: "Check the only case that could differ: x = 0, y = 1 gives x·(x + y) = 0·1 = 0 but x + y = 1. The AND with x caps the result at x.",
        anchor: { locator: "slide 22", excerpt: "Properties table (absorption)" },
      },
      {
        kind: SA,
        tier: "retrieval",
        prompt: "Write the dual of the identity x + y·z = (x + y)·(x + z).",
        options: [],
        answer: -1,
        exact: ["x·(y + z) = x·y + x·z", "x(y+z)=xy+xz", "x(y+z)=xz+xy", "xy+xz=x(y+z)", "xz+xy=x(y+z)", "x(z+y)=xy+xz", "x(z+y)=xz+xy"],
        explanation: "Swap every AND with OR and vice versa: the dual of the second distributive law is the ordinary one, x·(y + z) = x·y + x·z. Both are true; duality guarantees it.",
        anchor: { locator: "slide 23", excerpt: "Dual of any true statement in Boolean algebra is also a true statement" },
      },
      {
        kind: MC,
        tier: "retrieval",
        prompt: "With no parentheses, how is x1 + x2 · x3' read?",
        options: ["((x1 + x2) · x3)'", "(x1 + x2) · (x3')", "x1 + (x2 · (x3'))", "(x1 + (x2 · x3))'"],
        answer: 2,
        explanation: "NOT binds tightest, then AND, then OR, so the complement applies to x3 alone, the product is formed next, and the OR comes last.",
        anchor: { locator: "slide 24", excerpt: "Operation order: NOT → AND → OR; to be clear, use parentheses" },
      },
      {
        kind: SA,
        tier: "mechanism",
        prompt: "A network already computes the right function. In one sentence, why would a designer still simplify its expression?",
        options: [],
        answer: -1,
        rubric: {
          requiredIdeas: ["A simpler equivalent expression needs fewer gates or inputs, so it is cheaper (or smaller, faster, lower power) to implement"],
          acceptableAlternatives: ["less hardware", "lower cost", "fewer logic gates", "cheaper circuit"],
          knownMisconceptions: [
            { description: "Believing simplification changes or improves the function's behaviour", indicativePhrasing: ["more accurate", "fixes the output", "works better"] },
          ],
        },
        explanation: "Functionally equivalent networks give identical outputs on every input; the only thing left to optimise is implementation cost.",
        anchor: { locator: "slide 18", excerpt: "It makes sense to use the simpler one, which is less costly to implement" },
      },
    ],
  },
  {
    id: "sop-and-pos",
    name: "Sum of Products & Product of Sums",
    summary:
      "To synthesise from a truth table, write a product term that is 1 for each row where f is 1 and OR them together. A minterm is a product term containing every variable once; a maxterm is its complement (dual). Sum of minterms is SoP; product of maxterms is PoS. The result is correct but not necessarily minimal.",
    source: { filename: L02, slideStart: 25, slideEnd: 30 },
    questions: [
      {
        kind: MC,
        prompt: "For a function of three variables, which of these is a minterm?",
        options: ["x1 + x2", "x1 x2' x3", "x1'", "x1 x2 + x3"],
        answer: 1,
        explanation: "A minterm is a product in which each of the n variables appears exactly once, complemented or not.",
        anchor: { locator: "slide 27", excerpt: "Minterms: a product term in which each of the n variables appears once" },
      },
      {
        kind: MC,
        prompt: "f(x1, x2, x3) is 1 only for inputs 011 and 110. What is its canonical sum-of-products?",
        options: ["x1'·x2·x3 + x1·x2·x3'", "x2·x3 + x1·x2", "x1·x2·x3 + x1'·x2'·x3'", "(x1' + x2 + x3)·(x1 + x2 + x3')"],
        answer: 0,
        explanation: "One minterm per 1-row: 011 gives x1'·x2·x3 and 110 gives x1·x2·x3'. Option B is a simplification that is not canonical, and D is a product of sums.",
        anchor: { locator: "slide 25", excerpt: "create a product term that has a value of 1 for each valuation for which f has to be 1, then take a logical sum" },
      },
      {
        kind: TF,
        prompt: "The sum-of-products form obtained straight from a truth table is always the cheapest implementation.",
        options: ["True", "False"],
        answer: 1,
        explanation: "It is correct but not necessarily optimal; Boolean theorems (or a K-map) can usually simplify it further.",
        anchor: { locator: "slide 26", excerpt: "Not necessarily the optimal in terms of implementation cost … further simplification using Boolean algebra" },
      },
      {
        kind: MC,
        prompt: "Which maxterm goes with the row x1 = 1, x2 = 0, x3 = 1, where f must be 0?",
        options: ["x1' + x2 + x3'", "x1 + x2' + x3", "x1·x2'·x3", "x1' + x2' + x3'"],
        answer: 0,
        explanation: "A maxterm is 0 only on its own row, so each variable appears complemented when it is 1 and plain when it is 0. Option B is the maxterm for row 010; C is the minterm of this row, not the maxterm.",
        anchor: { locator: "slide 29", excerpt: "Maxterm: the dual of minterm; product of sums: the dual of SoP" },
      },
    ],
  },
  {
    id: "nand-nor-demorgan",
    name: "NAND, NOR & DeMorgan",
    summary:
      "In CMOS, NAND and NOR are simpler to build than AND and OR, so real circuits use them. DeMorgan's theorem, (x1x2)' = x1' + x2' and (x1 + x2)' = x1'x2', lets any sum-of-products network be built from NANDs alone and any product-of-sums network from NORs alone.",
    source: { filename: L02, slideStart: 31, slideEnd: 34 },
    questions: [
      {
        kind: MC,
        prompt: "Why are NAND and NOR gates preferred in CMOS designs?",
        options: ["They are faster to type in Verilog", "They are implemented with simpler circuits than AND and OR", "They use fewer inputs", "They never need DeMorgan's theorem"],
        answer: 1,
        explanation: "In CMOS a NAND or NOR is a single stage; AND and OR need an extra inverter.",
        anchor: { locator: "slide 31", excerpt: "NAND and NOR attractive as they are implemented with simpler electronic circuits than AND and OR" },
      },
      {
        kind: MC,
        prompt: "(x1 + x2 + x3)' equals…",
        options: ["x1' + x2' + x3'", "x1' · x2' · x3'", "x1 · x2 · x3", "(x1' + x2')·x3"],
        answer: 1,
        explanation: "Complementing a sum gives a product of complements. Option A is the complement of the product (x1·x2·x3)', the other DeMorgan form.",
        anchor: { locator: "slide 32", excerpt: "(x1 + x2)' = x1' x2'" },
      },
      {
        kind: MC,
        prompt: "A sum-of-products network can be realised using only…",
        options: ["NOR gates", "NAND gates", "XOR gates", "Buffers"],
        answer: 1,
        explanation: "Replace each AND and the final OR with NANDs: the double inversions cancel by DeMorgan. PoS networks map onto NORs the same way.",
        anchor: { locator: "slide 33", excerpt: "NAND for a SoP Network" },
      },
      {
        kind: TF,
        prompt: "(x1 · x2)' is the same function as x1' · x2'.",
        options: ["True", "False"],
        answer: 1,
        explanation: "By DeMorgan, (x1·x2)' = x1' + x2'. For x1 = 1, x2 = 0 the left side is 1 but x1'·x2' is 0, so they differ.",
        anchor: { locator: "slide 32", excerpt: "(x1 x2)' = x1' + x2'" },
      },
    ],
  },
  {
    id: "karnaugh-maps",
    name: "Karnaugh Maps",
    summary:
      "A K-map rearranges the truth table so cells that differ in one variable sit next to each other (columns ordered 00, 01, 11, 10). Grouping adjacent 1s minimises the circuit. Input combinations that can never occur are marked don't-care and may be used as 1 or 0, whichever simplifies more.",
    source: { filename: L02, slideStart: 36, slideEnd: 38 },
    questions: [
      {
        kind: MC,
        prompt: "In the K-map on the right, which cells are adjacent to m0 (top-left)?",
        options: ["m1 and m2 only", "m1, m2 and m4", "m1, m2 and m3", "m2 and m6"],
        answer: 1,
        explanation: "m1 is below it, m2 is to its right, and m4 wraps around from the far right column (10 differs from 00 in one bit). m3 differs from m0 in two variables.",
        anchor: { locator: "slide 36", excerpt: "(b) Karnaugh map: columns 00 01 11 10" },
        figure: { src: "/figures/ald/l02-s36.png", alt: "A three-variable truth table beside its Karnaugh map with columns 00, 01, 11, 10" },
      },
      {
        kind: MC,
        prompt: "In the K-map on the right, the columns read 00, 01, 11, 10. Why that order?",
        figure: { src: "/figures/ald/l02-s36.png", alt: "A three-variable truth table beside its Karnaugh map with columns 00, 01, 11, 10" },
        options: ["It is numeric order", "Adjacent columns differ in exactly one variable", "It groups the even numbers", "It is arbitrary"],
        answer: 1,
        explanation: "Gray-code ordering makes horizontal and vertical neighbours differ by one bit, which is what lets a group of 1s drop a variable.",
        anchor: { locator: "slide 36", excerpt: "(b) Karnaugh map: 00 01 11 10" },
      },
      {
        kind: MC,
        prompt: "A certain input combination can never occur in your system. What is the best thing to do with its cell in the K-map?",
        options: ["Set it to 0 to be safe", "Set it to 1 to be safe", "Mark it don't-care and include it in a group only when that makes the group larger", "Leave the cell out of the map"],
        answer: 2,
        explanation: "Don't-cares are free: treat each one as 1 or 0, whichever gives a bigger (cheaper) group, and ignore the ones that don't help.",
        anchor: { locator: "slide 38", excerpt: "Certain input conditions can never occur; set the outputs of such input conditions to don't cares" },
      },
      {
        kind: TF,
        prompt: "Three adjacent 1s in a row of a K-map can be covered by a single product term.",
        options: ["True", "False"],
        answer: 1,
        explanation: "Groups must be rectangles of 1, 2, 4, 8… cells, because each doubling removes one variable. Three cells need two overlapping groups of two.",
        anchor: { locator: "slide 37", excerpt: "Karnaugh Map: a method to minimize logic circuits (grouping example)" },
      },
    ],
  },

  /* ───────────── L03 ───────────── */
  {
    id: "binary-and-twos-complement",
    name: "Binary & 2's Complement",
    summary:
      "n bits represent unsigned 0 … 2^n − 1. In 2's complement the MSB is negative-weighted; the negative of P is K = 2^n − P, computed by inverting all bits and adding 1. Subtraction becomes addition of the complement with the carry-out ignored. Overflow occurs when the carry into the MSB and the carry out of it differ. Sign extension never changes the value.",
    source: { filename: L03, slideStart: 2, slideEnd: 14 },
    questions: [
      {
        kind: SA,
        tier: "retrieval",
        prompt: "Write −6 as a 4-bit 2's complement number.",
        options: [],
        answer: -1,
        exact: ["1010"],
        explanation: "+6 = 0110; invert to 1001; add 1 to get 1010. Check: −8 + 2 = −6.",
        anchor: { locator: "slide 8", excerpt: "the 2's complement can be computed by inverting all bits of P and then adding 1" },
      },
      {
        kind: SA,
        tier: "retrieval",
        prompt: "What decimal value does the 4-bit 2's complement pattern 1011 represent?",
        options: [],
        answer: -1,
        exact: ["-5"],
        explanation: "The MSB weighs −8; the rest weigh +2 and +1: −8 + 2 + 1 = −5. Reading it as sign-and-magnitude would give −3, a different system.",
        anchor: { locator: "slide 7", excerpt: "2's complement: MSB is negative-weighted" },
      },
      {
        kind: SA,
        tier: "retrieval",
        prompt: "Compute 0101 − 0010 in 4-bit 2's complement. Type the 4-bit result.",
        options: [],
        answer: -1,
        exact: ["0011"],
        explanation: "Add the 2's complement of 0010, which is 1110: 0101 + 1110 = 1 0011. Drop the carry out; 0011 = 3.",
        anchor: { locator: "slide 12", excerpt: "(+5) 0101 + 1110 = 1 0011, ignore" },
      },
      {
        kind: SA,
        tier: "mechanism",
        prompt: "In 4 bits, 1001 (−7) + 1110 (−2) gives 1 0111. In one sentence, how do you know this overflowed?",
        options: [],
        answer: -1,
        rubric: {
          requiredIdeas: ["A valid overflow test: the carry into the MSB differs from the carry out of it (c3 = 0, c4 = 1), or equivalently two negatives produced a positive-looking result (0111 = +7), or −9 is outside the 4-bit range"],
          acceptableAlternatives: ["c3 and c4 are different", "negative plus negative gave a positive", "−9 doesn't fit in 4 bits"],
          knownMisconceptions: [
            { description: "Treating any carry out of the MSB as overflow", indicativePhrasing: ["there is a carry out", "a fifth bit appeared", "the 1 in front"] },
          ],
        },
        explanation: "A carry out alone proves nothing (5 + (−2) also carries out). The tell is c3 ≠ c4, or a sign that the operands can't produce.",
        anchor: { locator: "slide 13", excerpt: "c4 = 1, c3 = 0: different → overflow" },
      },
      {
        kind: SA,
        tier: "retrieval",
        prompt: "Sign-extend the 4-bit 2's complement value 1011 to 8 bits.",
        options: [],
        answer: -1,
        exact: ["11111011"],
        explanation: "Copy the sign bit leftwards: 1011 → 1111 1011. The value stays −5; padding with zeros would turn it into +11.",
        anchor: { locator: "slide 14", excerpt: "Even if you extend the sign bit infinitely, the value remains the same" },
      },
      {
        kind: MC,
        tier: "retrieval",
        prompt: "The 4-bit pattern 1011 is read in sign-and-magnitude and then in 2's complement. Which pair of values is right?",
        options: ["−3 and −5", "−5 and −3", "11 and −5", "−3 and −3"],
        answer: 0,
        explanation: "Sign-and-magnitude: sign 1, magnitude 011 → −3. 2's complement: −8 + 2 + 1 → −5. Same bits, different conventions.",
        anchor: { locator: "slides 6–7", excerpt: "Sign: 0 denotes +, 1 denotes −; 2's complement: MSB is negative-weighted" },
      },
    ],
  },
  {
    id: "fixed-and-floating-point",
    name: "Fixed-Point & Floating-Point",
    summary:
      "Fixed-point numbers put a radix point at a position only the designer knows; Qi.f notation names i integer and f fraction bits (0011_1010 in Q4.4 is 3.625). More integer bits give range, more fraction bits give precision, and multiplication can overflow and lose LSBs. Floating point stores ±1.M × 2^(E−127) with special codes for ±0, NaN and infinity.",
    source: { filename: L03, slideStart: 15, slideEnd: 21 },
    questions: [
      {
        kind: MC,
        prompt: "What value does 0101_1000 represent in Q4.4?",
        options: ["5.5", "5.8", "88", "0.5"],
        answer: 0,
        explanation: "Integer bits 0101 = 5, fraction bits 1000 = 0.5, total 5.5. Reading the fraction as a decimal (5.8) or the whole byte as an integer (88) are the classic slips.",
        anchor: { locator: "slide 16", excerpt: "0011_1010 in Q4.4 → 3.6250" },
      },
      {
        kind: MC,
        prompt: "Who or what keeps track of where the radix point sits in a fixed-point number?",
        options: ["The ALU hardware", "A hidden exponent field", "The designer; the machine doesn't know", "The compiler automatically"],
        answer: 2,
        explanation: "Fixed-point math is ordinary 2's complement integer math; the binary point is a convention you carry in your head and your code.",
        anchor: { locator: "slide 15", excerpt: "The location of radix point is set by you (machine doesn't know)" },
      },
      {
        kind: MC,
        prompt: "You must store values up to ±100 with steps of 0.01 in 16 bits. Which format works?",
        options: ["Q4.12", "Q8.8", "Q12.4", "Q16.0"],
        answer: 1,
        explanation: "Q8.8 spans −128 to 127.996 with a step of 1/256 ≈ 0.0039. Q4.12 only reaches ±8; Q12.4's step is 0.0625, too coarse.",
        anchor: { locator: "slide 17", excerpt: "larger range by using more integer bits; better precision by using more fraction bits" },
      },
      {
        kind: MC,
        prompt: "In the Q4.4 multiplication example, 6.5625 × 4.0625 came out as 1010.0000 after truncation. What went wrong?",
        options: ["Precision loss only", "Overflow: the true result 26.66 is outside the Q4.4 range", "Nothing; 1010.0000 is 10", "The radix point moved"],
        answer: 1,
        explanation: "The product needs more integer bits than Q4.4 offers, so the kept bits read as −6. Truncating the low bits also lost 0.0352 of precision.",
        anchor: { locator: "slide 18", excerpt: "In the above example, 1010.0000 is −6, not 26" },
      },
      {
        kind: MC,
        prompt: "A float's stored exponent field is E = 130. By what power of two is the mantissa scaled?",
        options: ["2^130", "2^3", "2^−3", "2^127"],
        answer: 1,
        explanation: "The exponent is biased: actual exponent = E − 127 = 3. Forgetting the bias (2^130) is the common mistake.",
        anchor: { locator: "slide 19", excerpt: "Value = (±)1.M · 2^(E−127); E ranges from 0 to 255" },
      },
      {
        kind: TF,
        prompt: "In floating point, +0 and −0 are distinct bit patterns but compare as equal.",
        options: ["True", "False"],
        answer: 0,
        explanation: "The sign bit makes two zeros, and the standard defines them to compare equal. NaN and ±infinity are the other special values.",
        anchor: { locator: "slide 20", excerpt: "−0 and +0 are distinct values, though they both compare as equal" },
      },
    ],
  },
  {
    id: "adders",
    name: "Adders: Half, Full, Ripple & Lookahead",
    summary:
      "A half adder gives s = x ⊕ y and cout = xy; a full adder adds a carry-in, with cout the majority function and s the odd-parity (3-input XOR). Chaining full adders gives a ripple-carry adder whose delay grows with the carry chain, about 2n + 1 gate delays. Carry-lookahead computes carries from generate and propagate signals in parallel, and hierarchical CLA scales that to wide adders.",
    source: { filename: L03, slideStart: 22, slideEnd: 31 },
    questions: [
      {
        kind: MC,
        prompt: "A full adder gets x = 1, y = 0, cin = 1. What are sum and carry-out?",
        options: ["s = 1, cout = 0", "s = 0, cout = 1", "s = 1, cout = 1", "s = 0, cout = 0"],
        answer: 1,
        explanation: "Two of the three inputs are 1, so the majority (carry) is 1 and the odd-parity sum is 0: 1 + 0 + 1 = 10 in binary.",
        anchor: { locator: "slide 23", excerpt: "cout = majority function; si = xi XOR yi XOR cin = odd parity function" },
      },
      {
        kind: MC,
        prompt: "In the 8-bit ripple-carry adder shown, which addition is the worst case for delay?",
        figure: { src: "/figures/ald/l03-s24.png", alt: "Eight full adders chained by carries c1 to c7, from x0 y0 on the right to x7 y7 on the left" },
        options: ["50 + 4", "0 + 0", "1 + (−1), where the carry ripples through every stage", "127 + 0"],
        answer: 2,
        explanation: "00000001 + 11111111 makes every carry 1, so the result isn't valid until the carry has rippled through all eight full adders.",
        anchor: { locator: "slide 26", excerpt: "worst-case = longest carry chain (all carries are 1): 00000001 + 11111111" },
      },
      {
        kind: MC,
        prompt: "Using the slide's model, about how many gate delays does a 16-bit ripple-carry adder need before its final carry is valid?",
        options: ["16", "33", "5", "8"],
        answer: 1,
        explanation: "The carry chain costs 2n + 1 gate delays: 2·16 + 1 = 33. Doubling the width doubles the wait, which is what lookahead fixes.",
        anchor: { locator: "slide 28", excerpt: "C2 delay is 5 gate delay; for n bits, it becomes (2n + 1) gate delay" },
      },
      {
        kind: MC,
        prompt: "In a carry-lookahead adder, c2 is expressed as…",
        options: ["g1 + p1·c1 only, computed after c1", "g1 + p1·g0 + p1·p0·c0, directly from the inputs", "x1 ⊕ y1", "c1 + 1"],
        answer: 1,
        explanation: "Expanding c1 into c2 removes the dependence on the previous carry, so c2 is ready after about three gate delays regardless of position.",
        anchor: { locator: "slide 29", excerpt: "c2 = g1 + p1g0 + p1p0c0; C2 is generated after three gate delays" },
      },
      {
        kind: MC,
        prompt: "Why use a hierarchical CLA instead of one flat lookahead for 32 bits?",
        options: ["Flat lookahead is slower than ripple", "The two-level SOP for a flat CLA becomes impractically large", "Hierarchy removes the need for XOR gates", "It saves no area but looks nicer"],
        answer: 1,
        explanation: "Group the adder into 8-bit sections with their own P and G, then look ahead across sections: c8 = G0 + P0c0, c16 = G1 + P1G0 + P1P0c0, all in parallel.",
        anchor: { locator: "slide 29–30", excerpt: "The 2-level SOP becomes very large for a practical n → Hierarchical CLA: divide 32-b adder into 4 8-bit sections" },
      },
      {
        kind: TF,
        prompt: "In a lookahead adder, the generate signal g_i = x_i · y_i means stage i produces a carry-out no matter what its carry-in is.",
        options: ["True", "False"],
        answer: 0,
        explanation: "If both operand bits are 1 the stage generates a carry on its own; propagate p_i = x_i + y_i covers the case where an incoming carry passes through.",
        anchor: { locator: "slide 28", excerpt: "c1 = g0 + p0c0; c2 = g1 + p1c1" },
      },
    ],
  },
  {
    id: "multipliers",
    name: "Array Multipliers",
    summary:
      "A W×W multiply produces a 2W-bit product; constant word-length designs truncate the W−1 LSBs. Partial products are summed in an array: a carry-ripple array has a critical path that scales with 2W, while a carry-save array defers carries to a final vector-merging adder and scales with W. Baugh-Wooley handles signed operands by inverting a few partial-product bits instead of sign-extending.",
    source: { filename: L03, slideStart: 32, slideEnd: 42 },
    questions: [
      {
        kind: MC,
        prompt: "Two 8-bit Q1.7 operands are multiplied. How wide is the full product, and how many LSBs does a constant-word-length design drop?",
        options: ["8 bits, drop 0", "16 bits, drop 7", "16 bits, drop 8", "15 bits, drop 7"],
        answer: 1,
        explanation: "A W×W multiply yields 2W = 16 bits; keeping the word length truncates W − 1 = 7 LSBs. Dropping 8 would throw away a magnitude bit.",
        anchor: { locator: "slide 32", excerpt: "A W×W multiplication generates 2W bit product; (W−1) LSBs are truncated" },
      },
      {
        kind: MC,
        prompt: "What is the key idea of a carry-save array multiplier?",
        options: ["Propagate every carry immediately", "Save each carry and add it, aligned, into the next row; merge at the end", "Use only half adders", "Compute the product serially"],
        answer: 1,
        explanation: "Additions within a row become independent and parallel; a vector-merging adder resolves the saved carries in the last step.",
        anchor: { locator: "slide 38", excerpt: "Do not propagate carry; save carry and add it, with proper alignment, to the next operand … a vector merging adder (VMA) is used in the final step" },
      },
      {
        kind: MC,
        prompt: "How do the critical paths of the carry-ripple and carry-save array multipliers compare?",
        options: ["Both scale with W", "Ripple scales with 2W; carry-save with W plus the VMA", "Ripple is always faster", "Neither depends on W"],
        answer: 1,
        explanation: "In the ripple array the longest path runs diagonally across the array (about 2W); carry-save cuts it to W + T_VMA, and pipelining can reduce it further.",
        anchor: { locator: "slides 37–39", excerpt: "Critical path scales w/ 2W … Carry-save: critical path W + T_VMA" },
      },
      {
        kind: MC,
        prompt: "A designer sums 2's complement partial products with plain adders, no sign extension and no Baugh-Wooley inversion. What breaks?",
        options: ["Nothing, 2's complement adds directly", "Products involving a negative operand come out wrong, because the sign bit's negative weight is treated as positive", "Only the final carry-out is lost", "Overflow is reported on every multiply"],
        answer: 1,
        explanation: "The MSB of each partial product carries negative weight. Either extend the sign across the full width or, as Baugh-Wooley does, invert selected bits and add constants so plain addition becomes correct.",
        anchor: { locator: "slides 35, 42", excerpt: "Direct addition cannot be performed due to the negative weight; sign-bit extension is replaced with inversion" },
      },
      {
        kind: TF,
        prompt: "In a 2's complement tabular multiplication, partial products can be added directly without any sign handling.",
        options: ["True", "False"],
        answer: 1,
        explanation: "Direct addition fails because of the negative weight of the sign bit; you need sign extension (or a trick like Baugh-Wooley).",
        anchor: { locator: "slide 35", excerpt: "Direct addition cannot be performed due to the negative weight; sign extension" },
      },
    ],
  },
  {
    id: "booth-recoding",
    name: "Booth Recoding",
    summary:
      "Booth recoding rewrites a run of m ones in the multiplier as two signed digits, so fewer partial products are generated. Modified (radix-4) Booth examines overlapping 3-bit groups and selects 0, ±1 or ±2 times the multiplicand, producing at most n/2 + 1 partial products. It helps area for constant multiplication but does not shorten the critical path by itself.",
    source: { filename: L03, slideStart: 43, slideEnd: 53 },
    questions: [
      {
        kind: MC,
        prompt: "The multiplier is 0111 1110. How many nonzero partial products does plain shift-and-add need, and how many after Booth recoding of the run of 1s?",
        options: ["6, then 2", "6, then 6", "8, then 4", "2, then 2"],
        answer: 0,
        explanation: "Six 1-bits mean six partial products. Booth rewrites the run 0111 1110 as 1000 0000 − 0000 0010, two signed-digit terms.",
        anchor: { locator: "slide 43", excerpt: "Instead of m partial products, only 2 partial products are generated and signed-digit representation is used" },
      },
      {
        kind: MC,
        prompt: "In modified Booth recoding, what does the 3-bit group 1 0 0 (bits i+1, i, i−1) select?",
        options: ["+1 × M", "+2 × M", "−2 × M", "0 × M"],
        answer: 2,
        explanation: "1 0 0 marks the beginning of a string of 1s and contributes −2M; 0 1 1 (end of a string) gives +2M, and 1 1 1 gives 0.",
        anchor: { locator: "slide 48", excerpt: "1 0 0 → −2*M: Beginning of a string of 1's" },
      },
      {
        kind: MC,
        prompt: "With modified (radix-4) Booth recoding, at most how many partial products does an 8-bit multiplier produce?",
        options: ["8", "5", "4", "9"],
        answer: 1,
        explanation: "n/2 + 1 = 5 for n = 8: the 3-bit overlapping groups cover two multiplier bits each, plus one extra group from the padding.",
        anchor: { locator: "slide 46", excerpt: "Modified Booth: can produce at most n/2+1 partial products" },
      },
      {
        kind: MC,
        prompt: "Before forming 3-bit groups for an even-length multiplier, how is it padded?",
        options: ["One zero at the MSB only", "One zero at the LSB and two zeros at the MSB", "Two zeros at the LSB", "No padding is needed"],
        answer: 1,
        explanation: "Pad the LSB with a zero, pad the MSB with two zeros if n is even (one if odd), then take overlapping groups of three.",
        anchor: { locator: "slide 46", excerpt: "1. Pad the LSB with one zero. 2. Pad the MSB with 2 zeros if n is even and 1 zero if n is odd" },
      },
      {
        kind: TF,
        prompt: "Booth recoding makes a multiplier faster by shortening its critical path.",
        options: ["True", "False"],
        answer: 1,
        explanation: "It can reduce the number of 1s (good for constant multiplication) but doesn't save speed, and it adds recoding and subtraction circuitry.",
        anchor: { locator: "slide 45", excerpt: "It doesn't save in speed … Increases area: recoding circuitry AND subtraction" },
      },
      {
        kind: MC,
        prompt: "What extra multiples would a radix-8 Booth scheme have to generate?",
        options: ["Only ±1", "±3 and ±4 as well as ±1, ±2", "Only ±2", "±16"],
        answer: 1,
        explanation: "Higher radix means fewer operands but harder multiples: ×3 isn't a plain shift, which is why radix-4 is the common choice.",
        anchor: { locator: "slide 53", excerpt: "Radix-8 should implement *3, *-3, *4, *-4" },
      },
    ],
  },

  /* ───────────── L04 ───────────── */
  {
    id: "verilog-basics",
    name: "Verilog Basics: Signals, Nets & Modules",
    summary:
      "Verilog (IEEE 1364-1995) describes hardware; this course uses it for synthesis. Signals take 0, 1, Z (high-impedance) or X. Sized constants look like 4'b100. wire is a net; reg is a variable that may or may not become storage after synthesis. A module can be written structurally from gate primitives or behaviourally with continuous assign statements.",
    source: { filename: L04, slideStart: 2, slideEnd: 12 },
    questions: [
      {
        kind: MC,
        prompt: "What does the Verilog constant 4'b100 represent?",
        options: ["The decimal value 100", "A 4-bit binary value 0100, i.e. 4", "A 100-bit vector", "An unknown value"],
        answer: 1,
        explanation: "The format is [size]'[base]constant: 4 bits, binary, value 100 → 0100. 4'bx would be four unknown bits.",
        anchor: { locator: "slide 5", excerpt: "4'b100: a binary number 0100 = 4(10)" },
      },
      {
        kind: MC,
        prompt: "Besides 0 and 1, which two signal values does Verilog have?",
        options: ["2 and 3", "Z (high-impedance) and X (don't care/unknown)", "H and L", "+ and −"],
        answer: 1,
        explanation: "Z models an undriven or tri-stated net; X models an unknown or don't-care value.",
        anchor: { locator: "slide 5", excerpt: "Z: high-impedance; X: don't care" },
      },
      {
        kind: TF,
        prompt: "Declaring a signal as reg guarantees it becomes a flip-flop or latch after synthesis.",
        options: ["True", "False"],
        answer: 1,
        explanation: "reg is just a variable type; whether storage is inferred depends on how it is assigned, not on the keyword.",
        anchor: { locator: "slide 6", excerpt: "reg … doesn't guarantee to become a storage gate such as latches or flip-flops, post-synthesis" },
      },
      {
        kind: MC,
        prompt: "What does `reg [7:0] R [3:0];` declare?",
        options: ["One 32-bit register", "Four eight-bit variables", "Eight four-bit variables", "A 7-bit wire"],
        answer: 1,
        explanation: "The first range is the width of each element (8 bits); the second is the number of elements (4).",
        anchor: { locator: "slide 6", excerpt: "Reg [7:0] R [3:0]; → four eight-bit variables" },
      },
      {
        kind: MC,
        prompt: "Which statement describes a tri-state buffer that drives Y when E is 1 and floats otherwise?",
        options: ["assign F = E & Y;", "assign F = E ? Y : 1'bz;", "assign F = Y ? E : 0;", "assign F = ~E;"],
        answer: 1,
        explanation: "The conditional operator selects Y when the enable is true and the high-impedance literal 1'bz when it is false.",
        anchor: { locator: "slide 12", excerpt: "assign F = E ? Y : 1'bz;" },
      },
      {
        kind: MC,
        prompt: "Which of these module names is NOT legal Verilog?",
        options: ["mux_2to1", "Mux$2", "_mux2", "2to1_mux"],
        answer: 3,
        explanation: "Identifiers must start with a letter (or underscore) and may contain letters, digits, underscore and $. Starting with a digit is the illegal one. Note also that mux_2to1 and MUX_2TO1 would be different names.",
        anchor: { locator: "slide 10", excerpt: "Start w/ letter, only containing letter, number, underscore, and $; case sensitive" },
      },
    ],
  },
  {
    id: "behavioral-verilog",
    name: "Behavioral Verilog: always, if, case & loops",
    summary:
      "Procedural code lives in always blocks with a sensitivity list (always @* for combinational). A multiplexer can be written with the conditional operator, nested conditionals, if-else or case; an output assigned inside always must be a reg. A Verilog for loop unrolls into parallel subcircuits rather than steps in time; generate loops with genvar can instantiate modules. Tasks live inside a module; functions may be outside and cannot call tasks.",
    source: { filename: L04, slideStart: 13, slideEnd: 27 },
    questions: [
      {
        kind: MC,
        prompt: "How does a Verilog for loop differ from one in C or Python?",
        options: ["It cannot have a counter", "Each iteration describes a different subcircuit rather than a step in time", "It runs only once", "It is only allowed in testbenches"],
        answer: 1,
        explanation: "Synthesis unrolls the loop into parallel hardware; nothing happens 'later' on successive iterations.",
        anchor: { locator: "slide 21", excerpt: "the Verilog loop does not specify changes that take place in time; instead, during each iteration, it specifies different subcircuits" },
      },
      {
        kind: MC,
        prompt: "What can a generate for-loop do that a for-loop inside an always block cannot?",
        options: ["Use an integer counter", "Instantiate module instances", "Assign to a reg", "Use an if statement"],
        answer: 1,
        explanation: "Only generate (with a genvar) controls instantiation; it is also considered more synthesis-friendly.",
        anchor: { locator: "slide 25", excerpt: "you can't instantiate blocks in a for loop. Only the 'generate' for loop allows you to control instantiation" },
      },
      {
        kind: MC,
        prompt: "In `always @(w0, w1, s) f = s ? w1 : w0;`, how must f be declared?",
        options: ["output wire f", "output reg f", "input f", "parameter f"],
        answer: 1,
        explanation: "Anything assigned inside an always block has to be a variable (reg or integer); continuous assign targets are nets.",
        anchor: { locator: "slide 17", excerpt: "output reg f; always @(w0, w1, s) f = s ? w1 : w0;" },
      },
      {
        kind: MC,
        prompt: "A function body calls a task. What happens?",
        options: ["It works; functions and tasks are interchangeable", "It is illegal: a function can call functions but not tasks", "It works only in a testbench", "It works if the task is in another module"],
        answer: 1,
        explanation: "Tasks can call functions and tasks; functions can only call functions. The slide's advice: pick one of the two for a design and stick to it.",
        anchor: { locator: "slide 27", excerpt: "A function can invoke another function but not a task; a task can invoke another function and task" },
      },
      {
        kind: TF,
        prompt: "The expression `S[1] ? (S[0] ? w3 : w2) : (S[0] ? w1 : w0)` describes a 4-to-1 multiplexer.",
        options: ["True", "False"],
        answer: 0,
        explanation: "Nesting the conditional operator selects among four inputs using the two select bits.",
        anchor: { locator: "slide 18", excerpt: "assign f = S[1] ? (S[0] ? w3 : w2) : (S[0] ? w1 : w0);" },
      },
    ],
  },
  {
    id: "verilog-pitfalls-testbenches",
    name: "Parameters, Pitfalls & Testbenches",
    summary:
      "Per-instance parameters are passed with #(.n(16)). Classic mistakes: missing begin-end or semicolons, wrong replication braces, assigning a variable in more than one always block, mixing blocking (=) and non-blocking (<=), and defparam naming the module instead of the instance. A testbench instantiates the DUT, drives stimuli from an initial block with delays or @(posedge clk), and ends with $finish.",
    source: { filename: L04, slideStart: 28, slideEnd: 34 },
    questions: [
      {
        kind: MC,
        prompt: "Inside an always block, which assignment style should combinational logic use?",
        options: ["Non-blocking (<=)", "Blocking (=)", "Either, mixed freely", "assign statements"],
        answer: 1,
        explanation: "Combinational blocks use blocking =, sequential blocks use non-blocking <=, and the two should never be mixed in one block.",
        anchor: { locator: "slide 31", excerpt: "combinational circuits should use blocking (=); sequential should use non-blocking (<=); do not mix them in one always block" },
      },
      {
        kind: MC,
        prompt: "How do you instantiate `addern` with its parameter n set to 16 for instance U1?",
        options: ["addern U1 #16 (...);", "addern #(.n(16)) U1 (...);", "addern U1(n=16) (...);", "parameter addern.n = 16;"],
        answer: 1,
        explanation: "The #(.name(value)) list before the instance name overrides parameters per instance.",
        anchor: { locator: "slide 29", excerpt: "addern #(.n(16)) U1 (1'b0, A, B, S[15:0], S[16], o1);" },
      },
      {
        kind: MC,
        prompt: "Synthesis rejects your design because the signal count is driven from two different always blocks. What is the rule you broke?",
        options: ["A reg may only be read in one block", "A given variable must be assigned in only one always block", "Always blocks cannot share a sensitivity list", "count must be a wire"],
        answer: 1,
        explanation: "Two blocks driving one variable means two drivers for one piece of hardware, which is ambiguous. Merge the logic into a single always block.",
        anchor: { locator: "slide 31", excerpt: "a given variable should never be assigned a value in more than one always block" },
      },
      {
        kind: MC,
        prompt: "What is the correct way to write replication for three copies of A followed by two copies of B?",
        options: ["{3{A},2{B}}", "{{3{A}},{2{B}}}", "{A*3, B*2}", "{3A, 2B}"],
        answer: 1,
        explanation: "Each replication needs its own braces inside the concatenation; the missing-braces form is a listed pitfall.",
        anchor: { locator: "slide 30", excerpt: "Missing {}: {3{A},2{B}} instead of {{3{a}},{2{B}}}" },
      },
      {
        kind: MC,
        prompt: "In a testbench, how do you line up stimulus with the clock and end the simulation?",
        options: ["Use always @* and $stop", "Use @(posedge clk) for timing and $finish to end", "Use assign and $display", "Use generate and $end"],
        answer: 1,
        explanation: "The initial block initialises inputs, uses delays or @(posedge clk) to time stimulus and checks, loops over cycles, and finally calls $finish.",
        anchor: { locator: "slide 33", excerpt: "Event-control: Use @(posedge clk) to time when to give inputs and check outputs … Finally say $finish" },
      },
      {
        kind: TF,
        prompt: "Only nets (like wire) can be the target of a continuous assign statement.",
        options: ["True", "False"],
        answer: 0,
        explanation: "assign drives nets; values assigned inside always blocks must be reg or integer variables.",
        anchor: { locator: "slide 31", excerpt: "only nets can serve as the targets of continuous assignment statements" },
      },
    ],
  },
];

/** Question bank in the store's shape: topicId → questions with ids. */
export const ALD_QUESTION_BANK: Record<string, QuizQuestion[]> = Object.fromEntries(
  ALD_TOPICS.map((t) => [
    t.id,
    t.questions.map((q, i) => ({ id: `${t.id}-${i + 1}`, topic: t.name, ...q })),
  ]),
);
