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

const L01 = "L01_Intro.pdf";
const L02 = "L02_Combinational.pdf";
const L03 = "L03_Arithmetic.pdf";
const L04 = "L04_Verilog_for_comb_1.pdf";

const MC = "Multiple choice" as const;
const TF = "True or false" as const;

export const ALD_TOPICS: ContentTopic[] = [
  /* ───────────── L01 ───────────── */
  {
    id: "why-chips-matter",
    name: "Why Chips Matter",
    summary:
      "By 1970 a whole microprocessor fit on one chip. Semiconductors split into logic, memory, analog and discrete, each with different design pressures, and companies like Apple, Google and Amazon now design their own silicon for performance, efficiency and supply-chain control.",
    source: { filename: L01, slideStart: 20, slideEnd: 30 },
    questions: [
      {
        kind: MC,
        prompt: "Which category of chip needs cutting-edge fabrication AND is the most complex to design?",
        options: ["Analog", "Discrete", "Logic", "Memory"],
        answer: 2,
        explanation: "Logic chips (CPUs, GPUs, FPGAs) need the newest nodes and are complex to design, with CAD, architecture and software all in play. Memory also needs new nodes but is less complex to design.",
        anchor: { locator: "slide 23", excerpt: "Logic: need cutting-edge fabrication technology, complex to design" },
      },
      {
        kind: MC,
        prompt: "What sets analog chips apart from logic and memory chips?",
        options: ["They need the newest process node", "Know-how matters more than the fabrication node", "They are the simplest to design", "They are sold in the highest volume"],
        answer: 1,
        explanation: "Analog parts (imagers, ADC/DAC, PMIC) don't need the newest node; hard-to-copy know-how is the moat, and they come in high variety at low volume.",
        anchor: { locator: "slide 23", excerpt: "Analog: don't need cutting-edge fabrication technology; know-how is critical" },
      },
      {
        kind: TF,
        prompt: "By 1970 it was possible to put almost all the circuitry of a microprocessor on a single chip.",
        options: ["True", "False"],
        answer: 0,
        explanation: "Until the 1960s logic was built from bulky discrete parts; by 1970 integration had reached the single-chip microprocessor.",
        anchor: { locator: "slide 21", excerpt: "By 1970 it was possible to implement almost all circuitry needed to realize a microprocessor on a single chip" },
      },
      {
        kind: MC,
        prompt: "Why do non-chip companies like Apple and Amazon design their own silicon?",
        options: ["Regulators require it", "Performance, custom features and supply-chain control", "It is cheaper than buying any chip", "To sell chips to competitors"],
        answer: 1,
        explanation: "Vertical integration buys performance and energy efficiency, custom functions (like Apple's camera image cores) and better cost and supply control.",
        anchor: { locator: "slide 29", excerpt: "Benefits: performance and energy efficiency; custom functionality; financial and supply-chain benefits" },
      },
      {
        kind: MC,
        prompt: "Which memory technology is the main memory in almost all computing systems?",
        options: ["NAND flash", "DRAM", "SRAM cache only", "HBM only"],
        answer: 1,
        explanation: "DRAM is main memory in mobile and cloud alike; NAND is the key data storage. HBM is a 3D DRAM variant, not a separate main-memory technology.",
        anchor: { locator: "slide 26", excerpt: "DRAM: main memory in almost all computing systems" },
      },
    ],
  },

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
        prompt: "A truth table defines a logic function by listing its output for every combination of inputs.",
        options: ["True", "False"],
        answer: 0,
        explanation: "That is the definition: a tabular specification of the function over all input valuations.",
        anchor: { locator: "slide 14", excerpt: "Logic function defined in the form of a table" },
      },
      {
        kind: MC,
        prompt: "An AND gate has inputs x1 through xn. When is its output 1?",
        options: ["When any one of the inputs is 1", "Only when every input is 1", "When exactly one input is 1", "Only when every input is 0"],
        answer: 1,
        explanation: "AND needs all inputs high, like switches in series. An OR gate is the opposite: any input high is enough, like switches in parallel.",
        anchor: { locator: "slide 15", excerpt: "AND gates: x1 × x2 × … × xn; OR gates: x1 + x2 + … + xn" },
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
        kind: MC,
        prompt: "Determining the function performed by an existing logic network is called…",
        options: ["Logic synthesis", "Logic analysis", "Physical design", "Timing simulation"],
        answer: 1,
        explanation: "Analysis goes from network to function; synthesis goes the other way, from a desired behaviour to a new network.",
        anchor: { locator: "slide 17", excerpt: "Determine the function performed by a logic network → logic analysis" },
      },
      {
        kind: MC,
        prompt: "Two networks f(x1,x2) and g(x1,x2) are functionally equivalent. What should a designer do?",
        options: ["Keep both for redundancy", "Use the simpler one, since it costs less to implement", "Always use the one with more gates", "Pick the one with more inputs"],
        answer: 1,
        explanation: "Equivalent functions give identical outputs for every input, so the only remaining difference is cost.",
        anchor: { locator: "slide 18", excerpt: "It makes sense to use the simpler one, which is less costly to implement" },
      },
      {
        kind: MC,
        prompt: "Who showed in the late 1930s that Boolean algebra describes circuits built with switches?",
        options: ["George Boole", "Claude Shannon", "Edward Huntington", "Maurice Karnaugh"],
        answer: 1,
        explanation: "Boole published the algebra in 1849; Shannon connected it to switching circuits almost ninety years later.",
        anchor: { locator: "slide 19", excerpt: "In the late 1930s Claude Shannon showed that Boolean algebra provides an effective means of describing circuits built with switches" },
      },
      {
        kind: MC,
        prompt: "Without parentheses, in what order are Boolean operations applied?",
        options: ["OR → AND → NOT", "AND → OR → NOT", "NOT → AND → OR", "Left to right only"],
        answer: 2,
        explanation: "NOT binds tightest, then AND (logical product), then OR (logical sum). Use parentheses when a function gets complex.",
        anchor: { locator: "slide 24", excerpt: "Operation order: NOT → AND → OR" },
      },
      {
        kind: TF,
        prompt: "The dual of any true statement in Boolean algebra is also a true statement.",
        options: ["True", "False"],
        answer: 0,
        explanation: "Duality means every function has at least two Boolean expressions, and one often maps to a simpler circuit.",
        anchor: { locator: "slide 23", excerpt: "Dual of any true statement in Boolean algebra is also a true statement" },
      },
      {
        kind: MC,
        prompt: "What are Huntington's basic postulates?",
        options: ["The rules for drawing schematics", "A small set of identities from which all the others can be derived", "The definitions of NAND and NOR", "The steps of logic synthesis"],
        answer: 1,
        explanation: "The slides single out theorems 5 and 8 and properties 10 and 12 as the postulates; every other identity follows from them.",
        anchor: { locator: "slide 23", excerpt: "Huntington's basic postulates … all the other identities can be derived from these postulates" },
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
        prompt: "The direct procedure for synthesising a truth table builds the function as…",
        options: ["A product of terms that are 0 where f is 0, then inverted", "A logical sum of product terms, one per row where f is 1", "A single XOR of all inputs", "A chain of multiplexers"],
        answer: 1,
        explanation: "One product term per 1-row, OR'd together, realises f directly; simplification can come afterwards.",
        anchor: { locator: "slide 25", excerpt: "create a product term that has a value of 1 for each valuation for which f has to be 1. Then take a logical sum of these product terms" },
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
        prompt: "How is a maxterm related to a minterm?",
        options: ["It is the same thing", "It is the complement (dual) of a minterm", "It has one fewer variable", "It only exists for two-variable functions"],
        answer: 1,
        explanation: "Maxterms are the complements of minterms, and product-of-sums is the dual of sum-of-products.",
        anchor: { locator: "slide 29", excerpt: "Maxterm: the dual of minterm. Product of sums: the dual of SoP" },
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
        prompt: "By DeMorgan's theorem, (x1 · x2)' equals…",
        options: ["x1' · x2'", "x1' + x2'", "x1 + x2", "(x1 + x2)'"],
        answer: 1,
        explanation: "Complementing a product gives a sum of complements; complementing a sum gives a product of complements.",
        anchor: { locator: "slide 32", excerpt: "(a) (x1 x2)' = x1' + x2'   (b) (x1 + x2)' = x1' x2'" },
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
        prompt: "A product-of-sums network maps naturally onto NOR gates.",
        options: ["True", "False"],
        answer: 0,
        explanation: "Each OR and the final AND become NORs, mirroring the NAND-for-SoP construction.",
        anchor: { locator: "slide 34", excerpt: "NOR for a PoS Network" },
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
        prompt: "What is a Karnaugh map for?",
        options: ["Simulating timing", "Minimising a logic circuit", "Converting binary to decimal", "Drawing a schematic"],
        answer: 1,
        explanation: "It is a graphical method to minimise logic functions by grouping adjacent minterms.",
        anchor: { locator: "slide 36", excerpt: "Karnaugh Map: A Method to Minimize Logic Circuits" },
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
        prompt: "When can an output be marked as a don't-care in a function definition?",
        options: ["When the designer is unsure of the spec", "When that input condition can never occur", "When the output is always 1", "Never: every row needs a value"],
        answer: 1,
        explanation: "An incompletely specified function leaves impossible input combinations as don't-cares, which the minimiser may treat as 0 or 1.",
        anchor: { locator: "slide 38", excerpt: "Certain input conditions can never occur; we can set the outputs of such input conditions to don't cares" },
      },
      {
        kind: TF,
        prompt: "A K-map contains the same information as the truth table, just arranged differently.",
        options: ["True", "False"],
        answer: 0,
        explanation: "The slide shows the truth table (a) and the K-map (b) side by side: same minterms, new layout.",
        anchor: { locator: "slide 36", excerpt: "(a) Truth table … (b) Karnaugh map" },
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
        kind: MC,
        prompt: "What range of unsigned integers can n bits represent?",
        options: ["0 to 2^n", "0 to 2^n − 1", "−2^(n−1) to 2^(n−1) − 1", "1 to 2^n"],
        answer: 1,
        explanation: "2^n distinct patterns, starting at 0, end at 2^n − 1. The signed range in option C is for 2's complement.",
        anchor: { locator: "slide 3", excerpt: "Using n bits allows representation of positive integers in the range 0 to 2^n − 1" },
      },
      {
        kind: MC,
        prompt: "How is the 2's complement of a positive number P formed in hardware?",
        options: ["Invert the MSB only", "Invert all bits, then add 1", "Add 1, then invert all bits", "Shift left by one"],
        answer: 1,
        explanation: "K1 = (2^n − 1) − P is the 1's complement (bitwise inversion) and K2 = K1 + 1 is the 2's complement.",
        anchor: { locator: "slide 8", excerpt: "the 2's complement can be computed by inverting all bits of P and then adding 1" },
      },
      {
        kind: MC,
        prompt: "In 4-bit 2's complement, 5 − 2 is computed as 0101 + 1110 = 1 0011. What happens to the leading 1?",
        options: ["It is the sign of the result", "It is ignored; the answer is 0011 = 3", "It signals overflow", "It is added back into the LSB"],
        answer: 1,
        explanation: "Subtraction is done by adding the 2's complement of the subtrahend; the carry out of the MSB is discarded.",
        anchor: { locator: "slide 12", excerpt: "(+5) 0101 + 1110 = 1 0011, ignore" },
      },
      {
        kind: MC,
        prompt: "How do you detect overflow in a 2's complement addition?",
        options: ["The result is negative", "The carry into the MSB and the carry out of the MSB differ", "There is any carry out at all", "Both operands have the same sign"],
        answer: 1,
        explanation: "Compare c3 (into the MSB) with c4 (out of it): equal means no overflow, different means overflow. 7 + 2 = 1001 overflows because c3 = 1 and c4 = 0.",
        anchor: { locator: "slide 13", excerpt: "Carry out (c3) in the MSB position and c4 in the MSB+1 position are same? No overflow. Different? Overflow." },
      },
      {
        kind: TF,
        prompt: "In 2's complement, 11 1111 0001 and 1111 1111 0001 represent the same value.",
        options: ["True", "False"],
        answer: 0,
        explanation: "Copying the sign bit leftwards (sign extension) never changes the value, no matter how far you extend.",
        anchor: { locator: "slide 14", excerpt: "Even if you extend the sign bit infinitely, the value remains the same" },
      },
      {
        kind: MC,
        prompt: "In sign-and-magnitude representation, what does the MSB mean?",
        options: ["The largest power of two", "0 for +, 1 for −", "Parity", "Overflow"],
        answer: 1,
        explanation: "The MSB is a pure sign flag and the remaining bits hold the magnitude, unlike 2's complement where the MSB carries negative weight.",
        anchor: { locator: "slide 6", excerpt: "Sign: 0 denotes +, 1 denotes −" },
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
        prompt: "What does Q4.4 mean?",
        options: ["4 bytes of integer, 4 bytes of fraction", "4 integer bits and 4 fractional bits", "A 4-bit number with 4 decimal places", "A 44-bit float"],
        answer: 1,
        explanation: "Qi.f gives the integer and fraction bit counts; 0011_1010 in Q4.4 reads as 3.625.",
        anchor: { locator: "slide 16", excerpt: "Qi.f where i is the number of integer bits and f is the number of fractional bits; 0011_1010 in Q4.4 → 3.6250" },
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
        prompt: "To get better precision in a fixed-point format you should…",
        options: ["Use more integer bits", "Use more fraction bits", "Use fewer total bits", "Switch to sign-magnitude"],
        answer: 1,
        explanation: "Integer bits buy range (Q4.4 spans −8 to 7.9375); fraction bits buy precision (Q4.4 resolves 0.0625).",
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
        prompt: "In the floating-point format on the slides, the value is (±)1.M × 2^(E − 127). What range can the stored E take?",
        options: ["−127 to 128", "0 to 255", "−128 to 127", "1 to 254 only"],
        answer: 1,
        explanation: "E is stored as a non-negative integer from 0 to 255; subtracting the bias of 127 gives an exponent from −127 to 128.",
        anchor: { locator: "slide 19", excerpt: "E is a non-negative integer ranging from 0 to 255; thus Exponent ranges from −127 to 128" },
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
        prompt: "What is the carry-out of a full adder in terms of its inputs x, y and cin?",
        options: ["x ⊕ y ⊕ cin", "xy + x·cin + y·cin (majority)", "x · y only", "x + y + cin"],
        answer: 1,
        explanation: "The carry is 1 when at least two of the three inputs are 1: the majority function. The sum is the 3-input XOR, the odd-parity function.",
        anchor: { locator: "slide 23", excerpt: "cout = xi yi + xi cin + yi cin = MAJORITY function; si = xi XOR yi XOR cin = ODD PARITY function" },
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
        prompt: "Roughly how does ripple-carry delay grow with the number of bits n?",
        options: ["Constant", "About log n", "About 2n + 1 gate delays", "About n² gate delays"],
        answer: 2,
        explanation: "Each stage adds two gate delays to the carry path; c2 already costs 5 gate delays in the two-bit example.",
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
        prompt: "A half adder has a carry-in input.",
        options: ["True", "False"],
        answer: 1,
        explanation: "A half adder adds two 1-bit operands with no carry-in; the full adder is the one with cin.",
        anchor: { locator: "slide 22", excerpt: "Half Adder: add two 1-bit operands with no carry-in" },
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
        prompt: "Multiplying two W-bit numbers gives a full-precision product of how many bits?",
        options: ["W", "W + 1", "2W", "W²"],
        answer: 2,
        explanation: "The product has 2W bits; constant word-length multipliers keep the top W by truncating the W − 1 LSBs.",
        anchor: { locator: "slide 32", excerpt: "A W×W multiplication generates 2W bit product; in constant word-length multiplication, (W−1) LSBs are truncated" },
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
        prompt: "What does the Baugh-Wooley scheme replace sign extension with?",
        options: ["Extra adders", "Inversion of selected partial-product bits", "A lookup table", "Booth recoding"],
        answer: 1,
        explanation: "Handling the negatively weighted terms algebraically lets you simply add all partial products, with sign-bit extension replaced by inversion.",
        anchor: { locator: "slide 42", excerpt: "Handles sign bits efficiently; sign-bit extension is replaced with inversion" },
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
        prompt: "Booth recoding replaces a group of m consecutive 1s in the multiplier with…",
        options: ["m partial products", "Two partial products using signed digits", "One partial product", "No partial products"],
        answer: 1,
        explanation: "…0{11…1}0… becomes …1{00…0}0… minus …0{00…1}0…, so only two signed-digit terms remain.",
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
        prompt: "At most how many partial products does modified Booth produce for an n-bit multiplier?",
        options: ["n", "n/2 + 1", "n/4", "2n"],
        answer: 1,
        explanation: "Grouping bits in overlapping pairs halves the partial-product count, which is the whole point of the radix-4 scheme.",
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
        prompt: "Which is a valid style rule for Verilog identifiers?",
        options: ["They may start with a digit", "They are case-insensitive", "They start with a letter and may contain letters, digits, underscore and $", "They may contain spaces"],
        answer: 2,
        explanation: "Names are case sensitive, start with a letter, and whitespace and indentation are ignored. Comments use //.",
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
        prompt: "Which of these is true about functions versus tasks?",
        options: ["A function can invoke a task", "A task must be in the module that calls it; a function can be outside a module", "Tasks cannot have outputs", "Functions must be defined after use"],
        answer: 1,
        explanation: "Functions can call functions but not tasks; tasks can call both. The slides suggest sticking to one of the two in a design.",
        anchor: { locator: "slides 26–27", excerpt: "Task: must be in the module that calls it. Function: can be outside of a module; a function can invoke another function but not a task" },
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
        prompt: "Which of these is a listed common mistake?",
        options: ["Assigning one variable in more than one always block", "Using // for comments", "Declaring outputs as reg", "Using a sensitivity list"],
        answer: 0,
        explanation: "A given variable should be driven from exactly one always block; multiple drivers make the hardware ambiguous.",
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
