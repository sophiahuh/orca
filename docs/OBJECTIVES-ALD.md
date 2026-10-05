# ALD learning objectives (draft for review)

Objectives are things a student can *do*, not facts they know. Each one becomes a bucket of
questions; the app will track which objectives a student has demonstrated. Drafted from the
slide ranges, the Brown & Vranesic (BV) sections the slide headers cite, and the syllabus
weights (RTL labs 21%, HW 10%, exams 40%, FIR-filter project 25%).

**Question types**
- **Drill**: randomised operands, answer checked exactly by code (bit patterns, numbers, Boolean
  expressions compared by truth table). Unlimited practice, no model cost.
- **Exact**: one fixed problem with an exactly checkable typed answer.
- **MC**: conceptual multiple choice, model-written, rubric-checked.

**Confidence**
- ●●● standard in every version of this course; safe to build now
- ●●○ almost certainly assessed, depth uncertain
- ●○○ inferred from emphasis (project, labs); needs your HW/exam to confirm

---

## Lecture 2 · Combinational logic (BV 2.1–2.8, 2.11–2.16)

### Logic circuits & switches
| Objective | Type | Conf |
|---|---|---|
| Translate a series/parallel switch network to its Boolean function and back | Exact, MC | ●●● |
| Fill in the truth table of a 2–3 input gate network | Drill | ●●● |
| Identify AND/OR/NOT/XOR behaviour from a truth table | Drill | ●●● |

### Boolean algebra
| Objective | Type | Conf |
|---|---|---|
| Apply precedence (NOT, AND, OR) to parse an unparenthesised expression | Drill | ●●● |
| Simplify an expression using absorption, combining, distributive and consensus | Exact (truth-table check) | ●●● |
| Prove or disprove equivalence of two expressions (e.g. via truth table) | Drill | ●●● |
| State the dual of an identity | Exact | ●●○ |
| Compute the cost (gates + inputs, BV's metric) of a network and compare two implementations | Exact | ●●○ |

### Sum of products & product of sums
| Objective | Type | Conf |
|---|---|---|
| Write the canonical SoP (minterm list) and PoS (maxterm list) from a truth table | Drill | ●●● |
| Convert Σm(…) notation to an expression and back | Drill | ●●● |
| Convert between a minterm list and the complementary maxterm list | Drill | ●●● |

### NAND, NOR & DeMorgan
| Objective | Type | Conf |
|---|---|---|
| Apply DeMorgan to complement an expression with 2–4 variables | Drill | ●●● |
| Convert a two-level AND-OR network to NAND-NAND, and OR-AND to NOR-NOR | Exact, MC | ●●● |
| Explain why NAND/NOR are preferred in CMOS | MC | ●●○ |

### Karnaugh maps
| Objective | Type | Conf |
|---|---|---|
| Place a minterm list on a 3- or 4-variable map (Gray-code cell order, wrap-around) | Drill (tap cells) | ●●● |
| Find the minimum SoP of a 3–4 variable function, including wrap-around groups | Drill (expression check) | ●●● |
| Find the minimum PoS by grouping 0s | Drill | ●●● |
| Use don't-cares to enlarge groups | Drill | ●●● |
| Identify prime implicants and essential prime implicants | Exact | ●●○ |
| 5-variable maps | Exact | ●○○ (BV covers it; not visible on the slides) |

## Lecture 3 · Computer arithmetic (BV 3.1–3.4, 3.6, 7.4–7.7)

### Binary & 2's complement
| Objective | Type | Conf |
|---|---|---|
| Convert between decimal, binary, hex (unsigned and 2's complement, n bits) | Drill | ●●● |
| Negate an n-bit number in 2's complement | Drill | ●●● |
| Add/subtract n-bit 2's complement numbers and decide whether overflow occurred (c_n vs c_n−1) | Drill | ●●● |
| State the representable range for n bits in each system | Exact | ●●● |
| Sign-extend correctly when widening | Drill | ●●● |

### Fixed & floating point
| Objective | Type | Conf |
|---|---|---|
| Convert a Qi.f bit pattern to its value and back | Drill | ●●● |
| Choose a Q format for a required range and precision | Exact, MC | ●●○ |
| Predict overflow and precision loss in a fixed-point multiply, and how many bits the product needs | Drill | ●●○ (project-relevant: FIR filter) |
| Decode an IEEE-style float (sign, biased exponent, 1.M) to a value | Drill | ●●○ |
| Recognise the special values (±0, NaN, ±∞) | MC | ●●○ |

### Adders
| Objective | Type | Conf |
|---|---|---|
| Compute sum and carry of a half/full adder for given inputs | Drill | ●●● |
| Trace carries through a ripple-carry adder for two given operands | Drill | ●●● |
| Estimate ripple delay in gate delays for n bits (2n + 1) | Exact | ●●● |
| Write c_i in terms of g, p and c_0 for a lookahead adder, and estimate its delay | Exact | ●●● |
| Explain hierarchical CLA (block P and G) | MC | ●●○ |

### Array multipliers
| Objective | Type | Conf |
|---|---|---|
| Form the partial-product array for a small unsigned multiply (tabular form) | Drill | ●●● |
| Determine product width and which bits a constant-width result keeps | Drill | ●●● |
| Compare critical paths of carry-ripple vs carry-save arrays; explain the vector-merging adder | MC | ●●○ |
| Multiply signed numbers in tabular form with sign extension; explain what Baugh-Wooley changes | Exact, MC | ●●○ |

### Booth recoding
| Objective | Type | Conf |
|---|---|---|
| Recode a multiplier with radix-4 (modified) Booth: pad, group, table lookup | Drill | ●●● |
| Count partial products with and without recoding | Drill | ●●● |
| Multiply two small numbers using the recoded partial products | Exact | ●●○ |
| Explain the area/speed trade-off and why radix-8 is rarely used | MC | ●●○ |

## Lecture 4 · Verilog for combinational logic

### Verilog basics
| Objective | Type | Conf |
|---|---|---|
| Read and write sized literals (4'b1010, 8'hFF) and identify their values | Drill | ●●● |
| Choose between wire and reg for a given use | MC | ●●● |
| Read a structural (gate-primitive) module and state the function it computes | Exact (expression check) | ●●● |
| Write a continuous assign for a given Boolean function | Exact (truth-table check of the expression) | ●●● |
| Write a tri-state buffer with the conditional operator | Exact | ●●○ |

### Behavioural Verilog
| Objective | Type | Conf |
|---|---|---|
| Write a 2-to-1 / 4-to-1 mux three ways: ?:, if-else, case | Exact | ●●● |
| Predict what an always @* block synthesises to; spot an incomplete sensitivity list | MC | ●●● |
| Explain what a for loop unrolls into, and when generate is required | MC | ●●○ |
| Decide between a task and a function for a subroutine | MC | ●●○ |

### Parameters, pitfalls & testbenches
| Objective | Type | Conf |
|---|---|---|
| Instantiate a parameterised module with per-instance #(.n(…)) | Exact | ●●● |
| Spot the classic mistakes in a short snippet (blocking vs non-blocking, multiple drivers, net vs variable, replication braces) | MC (code snippet) | ●●● |
| Read a testbench and say what stimulus it applies and when it ends | MC | ●●○ |
| Write a minimal testbench skeleton (DUT instance, initial block, $finish) | Exact | ●○○ (labs will tell) |

---

## What this changes in the app

1. Each question carries an `objectiveId`. Phase 1 tagged the 69 built-in questions with 40 of the
   objectives below; that built-in ALD course has since been removed from the app (it's in git
   history at 89e042b). ALD now comes from uploading these decks, which is also how extraction
   gets scored against this list (roadmap Phase 2, "Evaluation").
2. A topic is *done* when every objective in it is mastered (3 different questions answered
   correctly over at least 2 days, last two correct; `docs/MASTERY-PLAN.md` §2.4), not after one
   quiz. Only 7 of the 40 tagged objectives have 3 or more questions today, so most ALD topics
   can't be finished until generation adds questions (decided; see `docs/TO-DISCUSS.md`).
3. Drills are code: a generator produces fresh operands and the expected answer; a checker compares
   typed answers exactly (bit strings, integers, Boolean expressions by truth table). Phase 6.
4. Uploads create objectives: extraction proposes them against the course's existing list,
   reconciliation matches duplicates, and the student reviews topics (`docs/BACKEND-ROADMAP.md`
   Phase 2). Uploads from other courses get the same structure.
5. Session composition (spread across objectives, preferring unseen questions) is Phase 3.

## Where your input matters most

- Which objectives the midterm actually hits, and how deep (e.g. is Baugh-Wooley derivation or
  concept?). One past exam settles most of the ●●○ rows.
- The Verilog coding style the labs are graded on (names, always @* vs explicit lists, SystemVerilog
  constructs allowed?).
- Anything you'd *remove*: an objective the instructor skipped is noise, not coverage.
