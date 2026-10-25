/**
 * Pages read from their images (docs/superpowers/plans/2026-10-18-handwritten-notes.md):
 * - `transcribePages`: a handwritten or scanned page (`needs-vision`) is written out from its image,
 *   and that text replaces the page's own (rough or missing) text;
 * - `describeFigures`: a typed slide that draws a figure (`needs-figure`) is sent with its text, and
 *   a description of what the figure adds is appended as "[Figures: …]"; the text stays as it was.
 * Pages go a few at a time, a few calls at once. A page that can't be rendered, or a batch whose call
 * fails, keeps its text and is reported, so a problem here never sinks the upload. Model calls and
 * rendering are injected. Pure.
 */
import type { MaterialPages } from "../data.ts";
import { sanitize } from "../untrusted/sanitize.ts";
import type { CallStep } from "./run.ts";
import { TRANSCRIBE_PAGES_PER_CALL } from "./schemas.ts";

/** Calls running at once. */
const CONCURRENT = 3;

export interface ImageReadResult {
  /** The pages read from their images, with their new text. */
  read: Array<{ n: number; text: string }>;
  /** Pages that kept their own text, and why. */
  kept: Array<{ n: number; reason: string }>;
}
export type TranscribeResult = ImageReadResult;

interface ReadInput {
  course: { name: string; short: string };
  material: { filename: string };
  pages: MaterialPages;
}
type Render = (n: number) => Promise<string | null>;

/**
 * The shared loop: render the `marked` pages, `send` them in batches, and turn each page's answer
 * into its new text (`textOf` gets the page and the answer; null when the model didn't return it).
 */
async function readFromImages(
  marked: MaterialPages,
  render: Render,
  send: (pages: Array<{ n: number; text: string; image: string }>) => Promise<Map<number, string>>,
  textOf: (page: { n: number; text: string }, answer: string) => string,
): Promise<ImageReadResult> {
  const result: ImageReadResult = { read: [], kept: [] };
  const batches: MaterialPages[] = [];
  for (let i = 0; i < marked.length; i += TRANSCRIBE_PAGES_PER_CALL) batches.push(marked.slice(i, i + TRANSCRIBE_PAGES_PER_CALL));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const ready: Array<{ n: number; text: string; image: string }> = [];
      for (const p of batch) {
        const url = await render(p.n).catch(() => null);
        const image = url?.replace(/^data:image\/[a-z]+;base64,/, "");
        if (image) ready.push({ n: p.n, text: p.text, image });
        else result.kept.push({ n: p.n, reason: "the page couldn't be drawn as an image" });
      }
      if (!ready.length) continue;
      try {
        const answers = await send(ready);
        for (const p of ready) {
          const answer = answers.get(p.n);
          if (answer === undefined) result.kept.push({ n: p.n, reason: "the model didn't return this page" });
          else result.read.push({ n: p.n, text: sanitize(textOf(p, answer)).text });
        }
      } catch (e) {
        for (const p of ready) result.kept.push({ n: p.n, reason: `couldn't be read from its image: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT, batches.length) }, worker));
  result.read.sort((a, b) => a.n - b.n);
  result.kept.sort((a, b) => a.n - b.n);
  return result;
}

export function transcribePages(input: ReadInput, deps: { call: CallStep; render: Render }): Promise<ImageReadResult> {
  return readFromImages(
    input.pages.filter((p) => p.source === "needs-vision"),
    deps.render,
    async (pages) => {
      const out = await deps.call("transcribe", { course: input.course, material: { filename: input.material.filename }, pages: pages.map(({ n, image }) => ({ n, image })) });
      return new Map(out.pages.map((p) => [p.n, p.text]));
    },
    (_page, answer) => answer,
  );
}

export function describeFigures(input: ReadInput, deps: { call: CallStep; render: Render }): Promise<ImageReadResult> {
  return readFromImages(
    input.pages.filter((p) => p.source === "needs-figure"),
    deps.render,
    async (pages) => {
      const out = await deps.call("describe", { course: input.course, material: { filename: input.material.filename }, pages: pages.map(({ n, text, image }) => ({ n, text, image })) });
      return new Map(out.pages.map((p) => [p.n, p.figures]));
    },
    // Nothing worth describing (decoration only): the text as it was.
    (page, figures) => (figures.trim() ? `${page.text}\n\n[Figures: ${figures.trim()}]` : page.text),
  );
}
