# Quiz question rubric

What makes a question worth asking in Orca. Written from Sophia's reviews of the ALD set;
every rule below came from a real question that failed. The generator prompt includes this
file, and the checker pass (planned) grades each generated question against it.

## Shape (from the assessment-blueprint model)

0. **Every question works on a concrete instance.** A given bit pattern, expression, circuit,
   array, snippet or scenario. Five tiers describe what the student must *do* with it:
   - *retrieval*: run a procedure on the instance (convert, simplify, trace, classify)
   - *mechanism*: explain why or how, in one sentence
   - *application*: solve a small problem with constraints
   - *connection*: relate two ideas (why does X make Y possible / cheaper / wrong)
   - *transfer*: design something new from the ideas
   Quick review uses retrieval + mechanism (under a minute). Deep review uses application +
   connection. Exam review mixes in transfer.
   - Not a question: "What is a max-heap?"
   - Retrieval: "Draw [4, 12, 8, 21, 14, 9, 17] as a complete tree. Max-heap, min-heap or neither?"
   - Mechanism: "Why is insert_last on a dynamic array Θ(1) amortised when a single call can be Θ(n)?"
0a. **Match the course, and test the idea, not arithmetic.** Read what kind of thinking the
   material teaches. A conceptual or systems course gets scenarios to reason about (predict the
   effect of a change, diagnose a symptom, choose between designs, explain a trade-off); procedures
   are traced only where the material teaches one. Never ask a question whose only work is plugging
   given numbers into a stated formula or doing the multiplication. Ask what the formula means
   instead (which term dominates, what happens when one input doubles, which change helps). At most
   one calculation per objective, none for a conceptual objective. (Added 2026-10-10 after a
   Networks for AI upload produced dozens of "X GB at Y TB/s is how many ms?" questions.)
   - Not a question: "Reading 16 GB at 3.2 TB/s takes how long?"
   - Right: "A batch-one decode step spends 5 ms reading HBM and 0.05 ms on math. Which upgrade
     helps most, and why?"
0b. **Prefer typed answers over multiple choice.** If the answer has an exact form (bits, a number,
   a short expression) the student types it and code checks it. If it's a one-sentence "why", a
   rubric grades it: required ideas, acceptable phrasings, known misconceptions; never the
   grader's own opinion. Multiple choice only when choosing between plausible alternatives *is*
   the skill.
   An exact answer must have one short form a student writes the same way (a number, bits, an
   expression, a named term), with every natural variant listed. A judgement among a few fixed
   choices ("valid" or "invalid", yes or no, which of two) is multiple choice or true/false, not a
   typed answer: a student who writes "is valid" for "valid" is right, and the checker drops such
   lead-in words, but it can't read every phrasing. (Added 2026-10-18.)
   A rubric's required ideas are the reasoning the student must supply, never a given the question
   already states, and the grader marks understanding, not wording: "now each set holds twice as
   many ways" fully answers why doubling associativity (same sets, same line size) doubles
   capacity; the unchanged sets and line size are the question's givens. (Added 2026-10-20.)
   Required ideas come only from what the material teaches: the grader never sees the material, so
   the writer keeps anything beyond it out of the rubric (it may be in the explanation, or an
   acceptable alternative). For an inferred objective, the rubric requires only its core idea. The
   grader never marks down for a detail beyond what the question asks, only for what's wrong.
   (Added 2026-10-20.)

## Level

1. **Assume the course's level, not the topic's.** ALD is an upper-level course; Lecture 2 is a
   refresher, not an introduction. A question an intro student could answer from the definition
   alone is too easy. Target *apply* or *analyse*: give a small circuit, expression, bit pattern or
   code fragment and ask what it does, what it equals, or how to build it.
   - Too easy: "When does an AND gate output 1?"
   - Right: "A switch network implements f = (x1 + x2)·x3. How are the switches arranged?"
2. **At most one recall question per topic**, and only for a fact students actually forget
   (a threshold, a formula, a rule with a non-obvious consequence).

## Fairness

3. **Never test notation before the slide that defines it.** "+", "·", "⊕", "'" and overbars are
   introduced on slide 24 of Lecture 2; questions before that point must say AND, OR, XOR, NOT in
   words. In general, a question may only assume vocabulary from its own slide range or earlier.
4. **If the question needs a figure, show the figure** and say "In the figure, …". Never describe
   a diagram the student can't see.
5. **Distractors must be wrong for a reason a student might believe**: the dual operation, an
   off-by-one, the unsigned reading of a signed pattern, the ripple answer to a lookahead question.
   No joke options ("No reason", "It is just convention").

## Grounding

6. **Every claim traces to a slide.** The anchor is the slide the answer comes from, quoted or
   closely paraphrased. If the slide is only a picture, cite it and attach it as the figure.
   The one exception is a question for an *inferred* objective (one drawn from general knowledge
   of the subject, not the uploaded material): it has no anchor, and its wording must not claim
   the course covered it ("In lecture…", "As the slides show…").
7. **Don't paraphrase the slide's sentence as the prompt.** Apply the idea instead, so reading the
   slide isn't enough; understanding it is.

## Form

8. Multiple choice has exactly four options and exactly one defensible answer. True/false is for
   statements with a tempting wrong reading, at most one per topic.
9. Answerable in under a minute without paper. No multi-step derivations in a quiz; those belong
   in a deep-review session.
10. The explanation teaches: say *why* the right answer is right and, when useful, why the most
    tempting distractor is wrong. One or two sentences.
