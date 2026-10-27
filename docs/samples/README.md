# Sample course material (not committed)

The extraction scorer (`npm run score:extraction`) uploads the Advanced Logic Design decks
`L02_Combinational.pdf`, `L03_Arithmetic.pdf` and `L04_Verilog_for_comb_1.pdf` from `docs/samples/ald/`
and scores the objectives it finds against `docs/OBJECTIVES-ALD.md`. The decks are the professor's
course material, so they aren't in the repository (`docs/samples/ald/` is ignored by git; they were
removed from the history on 2026-10-27 before the repository was made public). Put your own copies
in that folder to run the scorer; nothing else needs them.

The unit and browser tests use a generated stand-in deck instead (`makeDeck()` in
`tests/fixtures/pdf.ts`): 24 slides with the shapes the reader has to handle (picture-only slides,
drawn figures, a big image, sub- and superscripts).
