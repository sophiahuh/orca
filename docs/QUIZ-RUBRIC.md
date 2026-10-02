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
0b. **Prefer typed answers over multiple choice.** If the answer has an exact form (bits, a number,
   a short expression) the student types it and code checks it. If it's a one-sentence "why", a
   rubric grades it: required ideas, acceptable phrasings, known misconceptions; never the
   grader's own opinion. Multiple choice only when choosing between plausible alternatives *is*
   the skill.

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
7. **Don't paraphrase the slide's sentence as the prompt.** Apply the idea instead, so reading the
   slide isn't enough; understanding it is.

## Form

8. Multiple choice has exactly four options and exactly one defensible answer. True/false is for
   statements with a tempting wrong reading, at most one per topic.
9. Answerable in under a minute without paper. No multi-step derivations in a quiz; those belong
   in a deep-review session.
10. The explanation teaches: say *why* the right answer is right and, when useful, why the most
    tempting distractor is wrong. One or two sentences.
