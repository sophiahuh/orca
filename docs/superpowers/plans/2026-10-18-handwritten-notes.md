# Handwritten notes: read pages as images (2026-10-18)

**Status:** built 2026-10-18 (both parts), on `phase-4` and live.

**Why.** Orca reads a PDF's text layer only. Notes apps (GoodNotes, Notability…) store their own
handwriting recognition as an invisible, often tiny text layer: the hidden-text guard drops the
tiny parts, and what's left is garbled ("iisel, cell & think of as | in line 1 I -I voltage"), with
no diagrams. Scanned PDFs have no text layer at all ("no text"). The server's model (OpenAI or
Claude) reads handwriting and diagrams from a page image far better. Owner's decision: transcribe
such pages with the same model, from images rendered by our own renderer (pdf.js + @napi-rs/canvas;
no new dependency).

**When a page is read as an image.**
- The student ticks "Handwritten notes" on the upload page: every page.
- The PDF was made by a notes app (its Producer/Creator names GoodNotes, Notability, Noteshelf,
  Nebo, OneNote, Apple Notes, Samsung Notes, Xodo, Flexcil, CollaNote, Zoom Notes): every page.
- A page with almost no text (under 40 characters after sanitising): a scan or a drawing.
- .pptx decks never are (no renderer for them).

**Flow.** The reader marks pages (`material_pages.source`: `text` | `needs-vision` | `vision`).
The upload job, before extraction, renders each marked page (whole page, nothing painted over,
up to 1600 px wide), sends them a few at a time to a new `transcribe` step (images in, text per page
out: the handwriting written out, equations in plain notation, diagrams described in words),
stores the text on the page (`source: vision`) and continues as usual, so top-ups and dives read the
clean text too. Hidden-text counts don't apply to transcribed pages (the model reads only what's
visible). Metered and budgeted like every step; progress stage `transcribing`.

**Tasks** (each its own commit, Fix-mode checks per commit):
1. Renderer: an option to keep all text (no painting) and a width; one unit test.
2. `completeJson` takes images for both providers (Claude `image` blocks, OpenAI `input_image`);
   unit test on the request body.
3. The `transcribe` step: schema, prompt, budget, step caller passes images; unit test.
4. Migration (`materials.handwritten`, `material_pages.source`) + reader marks pages (producer,
   short text, the student's flag); unit test; pgTAP for the columns.
5. The job transcribes marked pages before extraction; unit test with a fake caller.
6. Upload page: "Handwritten notes" checkbox; the warning about hidden text isn't shown for
   transcribed pages.
7. Fake model API answers `transcribe`; one e2e spec (upload with the box ticked).
8. Docs: CLAUDE.md, BACKEND-ROADMAP, TO-DISCUSS (cost per page, the detection list).

## Part 2: describe the figures on typed slides (2026-10-18)

**Why.** A typed slide's text layer is exact, but its diagram, plot or circuit never reaches the
model. Transcribing whole slides would replace exact text with a reading (errors) and cost about $1
a deck, so instead: find the slides that draw a figure, send the image *with* the slide's text, ask
for a description of the visuals only, and append it as "[Figures: …]". The text stays as it was.

**Which slides.** From pdf.js's operator list, no model: an image of at least 100×100 px, or 25+
path operations (text-only slides draw 3–5, the template). Images that appear on more than half
the pages (template artwork, logos) don't count. ALD measured: L02 29/38 slides, L03 ~35/53.
Pages read as images anyway (`needs-vision`) aren't described again. Figure detection stops once
half the read budget is used, so a heavy file is never refused for it.

**Tasks.** (1) migration: `material_pages.source` also `needs-figure` | `figure`; the reader marks
figure pages; unit test. (2) a `describe` step (image + text in, figure description out); unit test.
(3) the job describes marked pages after transcription, before extraction (shared batching with
transcribe); unit test. (4) fake API + e2e expectations. (5) docs.
