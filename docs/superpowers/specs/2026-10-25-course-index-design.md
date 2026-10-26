# Course index: map uploads page by page through a table of contents

Status: design agreed 2026-10-25 (Amanda), not built. Plan to follow in `docs/superpowers/plans/`.

## Why

An upload today makes one extraction call that receives the whole file (cut at 180,000 characters,
so the end of a long file is never read) together with every topic and every objective in the
course. Duplicate checks compare each new item against the whole course, and question writing sends
the whole file for every batch of objectives. As a course grows, every upload carries all of it, and
the model has to place new material while looking at everything at once.

Goals, in order: every page of a file is mapped, and topics and objectives land in the right place
without duplicates. Cost per upload may stay about the same; speed is secondary.

## What changes, in one line

The model reads the course through an index: a table of contents of topics first, then one topic's
objectives at a time, and questions are written from each objective's own pages. The unit is a page,
not a file.

## Data

**`topics.source`** (existing jsonb column) changes meaning: from one range in one file,
`{ filename, slideStart, slideEnd }`, to every place the topic is taught, across uploads:

```
source: [
  { materialId: "8f3c…", from: 4, to: 9 },
  { materialId: "8f3c…", from: 14, to: 14 },
  { materialId: "a71e…", from: 1, to: 2 }
]
```

- `materialId` is `materials.id`; `from`/`to` are page numbers (inclusive). A topic on scattered pages
  has one entry per run of pages.
- A migration converts each existing topic's range using its `material_id`; a topic with no source,
  or no `material_id`, gets `[]`. The column becomes `not null default '[]'` and must be an array.
- Each upload appends this file's ranges; a range touching or overlapping one already there for the
  same material merges into it.
- Merging two topics gives the survivor the union of both lists.

**Unchanged:** `material_pages` (each page's text, written when a file is read), `objectives`
(`signals[].places` already hold page locators and excerpts per upload), `questions`.

**The table of contents is not stored.** Code builds it for each call from the topic rows: id, name,
summary, objective count, "rejected" when archived, and where it's taught with file names from
`materials` (the model sees "L3.pdf p4–9, 14; HW2.pdf p1–2", never UUIDs).

## How an upload runs

1. **Read** (unchanged): pages into `material_pages`; handwritten and figure pages read from their
   images first.
2. **Split into parts:** consecutive pages up to about 60,000 characters of text each, never
   splitting a page. A batch size, not a cap: a short file is one part, a 150-page file about ten.
   The 180,000-character cut is removed.
3. **For each part, in order:**
   - **`map` call:** the part's pages and the table of contents. Returns, for each topic these pages
     teach, an existing topic id or a new topic (name, summary), with its page ranges in this part;
     links between topics (as the extraction step returns today); text addressed to an AI
     (`instructionsFound`).
   - **Code:** validators as today (no length limits; URLs, HTML, links, instruction-like text
     refused); new topic names checked for duplicates against the table of contents (exact name,
     then the reconcile call against the closest topics); ranges added to `source`; new topics
     created.
   - **`objectives` call, one per topic touched** (up to 4 at a time): that topic's objectives
     (id, name, description, origin, places) and only its pages in this part. Returns existing
     objective ids covered, with this part's places, and new objectives with places, origin and
     emphasis, as today. New objectives are checked for duplicates within that topic only.
   - The next part sees the updated table of contents, so a topic running across parts is extended,
     not created twice.
4. **Topic links:** the link step runs after the last part, as today.
5. **Questions:** each objective needing questions is written from its own pages via `pagesFor`
   (its places plus a page either side, else its topic's ranges in this file, else the whole file
   when short), the way top-ups already work. Inferred objectives (no places) use their topic's
   pages in this file.
6. **Save:** everything in one `save_structure` transaction, as now.

## Prompts

- `map` carries the agreed topic rules: what a topic is (its own section, two or more skills of its
  own; a single drill is an objective), scale (a course rarely has more than about 200 topics;
  information, not a limit), examples (Data Structures: Trees, Binary search trees, Graphs, BFS, DFS,
  Merge sort; Calculus; Computer Systems), cover every section that teaches something, reuse first,
  names are short headings and summaries one or two sentences, the material-type rules, and the
  untrusted-material policy.
- `objectives` carries the objective rules: one skill one question can mark in under a minute, a verb
  on a concrete thing; split for two procedures; fold what a definition alone answers; the grain
  rules and examples now in the extract prompt; places; inferred objectives; emphasis.
- The `extract` step is removed once both are in.

## Failures

Each call already retries brief failures twice. Beyond that:

- A part's `map` call fails: its pages are listed in the run's left-out list ("Pages 41–55 couldn't
  be mapped: …"), the other parts carry on, the run finishes with what was mapped. Uploading the file
  again retries it.
- A topic's `objectives` call fails: listed the same way ("Objectives for Heaps couldn't be found:
  …"); other topics carry on.
- Nothing is filled in silently: every gap is in the left-out list the review screen shows.

## Progress

New progress messages in the upload's status line: "Mapping pages 41–55 (part 3 of 10)", "Finding
objectives in Heaps", then "Writing questions" as now.

## Cost and time

One `map` call per part plus one `objectives` call per topic touched; parts in order, a part's
topics in parallel. Long files take longer than today but are read whole; each call is small. Daily
page and token budgets still apply.

Risk: with `ORCA_JOBS=inline` a job runs inside its request, which Vercel stops at 300 s; a long file
could be cut off. The plan's first task confirms production's setting; if it is inline, jobs move to
Trigger.dev (30-minute limit) rather than the work being cut.

## Other readers of `topics.source`

- `whereTaught` (`src/lib/course/study.ts`): falls back to the topic's ranges from every file.
- `pagesFor` (`src/lib/pipeline/topup.ts`): falls back to the topic's ranges in the given material.
- `topicToRow` / `topicFromRow` (`src/lib/supabase/app-rows.ts`) and the `Topic` type.
- `scripts/score-extraction.ts` runs `map` and `objectives` instead of `extract`.
- `e2e/fake-anthropic.ts` answers both new steps.

## Tests (fake model, no real calls)

- A three-part file maps every page; each `map` call gets one part's pages only.
- A topic running across two parts is extended, not created twice; its ranges merge.
- An `objectives` call receives only its topic's objectives and pages.
- A new objective's duplicate check sees only its topic's objectives.
- Upload questions are written from each objective's own pages.
- The `source` migration converts old rows (pgTAP), and merging topics unions ranges.
- A failed part or topic call shows in the left-out list while the rest is kept.
- Browser specs for upload and review pass against the fake API.

## Out of scope

Objectives' places stay as they are (locator strings with excerpts). No new table, no embeddings, no
change to how material is read or to the review screen.
