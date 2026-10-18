/**
 * Read handwritten or scanned pages from their images (docs/superpowers/plans/2026-10-18-handwritten-notes.md):
 * each page marked `needs-vision` is rendered and sent, a few at a time, to the transcribe step;
 * what comes back is sanitised like any page and replaces the page's own (rough or missing) text.
 * A page that can't be rendered, or a batch whose call fails, keeps its text and is reported, so a
 * transcription problem never sinks the upload. Model calls and rendering are injected. Pure.
 */
import type { MaterialPages } from "../data.ts";
import { LIMITS } from "../limits.ts";
import { sanitize } from "../untrusted/sanitize.ts";
import type { CallStep } from "./run.ts";
import { TRANSCRIBE_PAGES_PER_CALL } from "./schemas.ts";

/** Transcribe calls running at once. */
const CONCURRENT = 3;

export interface TranscribeResult {
  /** The pages that were read from their images, with their new text. */
  read: Array<{ n: number; text: string }>;
  /** Pages that kept their own text, and why. */
  kept: Array<{ n: number; reason: string }>;
}

export async function transcribePages(
  input: { course: { name: string; short: string }; material: { filename: string }; pages: MaterialPages },
  deps: { call: CallStep; render: (n: number) => Promise<string | null> },
): Promise<TranscribeResult> {
  const marked = input.pages.filter((p) => p.source === "needs-vision").map((p) => p.n);
  const result: TranscribeResult = { read: [], kept: [] };
  const batches: number[][] = [];
  for (let i = 0; i < marked.length; i += TRANSCRIBE_PAGES_PER_CALL) batches.push(marked.slice(i, i + TRANSCRIBE_PAGES_PER_CALL));

  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const images: Array<{ n: number; image: string }> = [];
      for (const n of batch) {
        const url = await deps.render(n).catch(() => null);
        const image = url?.replace(/^data:image\/[a-z]+;base64,/, "");
        if (image) images.push({ n, image });
        else result.kept.push({ n, reason: "the page couldn't be drawn as an image" });
      }
      if (!images.length) continue;
      try {
        const out = await deps.call("transcribe", { course: input.course, material: { filename: input.material.filename }, pages: images });
        const byPage = new Map(out.pages.map((p) => [p.n, p.text]));
        for (const { n } of images) {
          const text = byPage.get(n);
          if (text === undefined) result.kept.push({ n, reason: "the model didn't return this page" });
          else result.read.push({ n, text: sanitize(text, LIMITS.pageChars).text });
        }
      } catch (e) {
        for (const { n } of images) result.kept.push({ n, reason: `couldn't be read from its image: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT, batches.length) }, worker));
  result.read.sort((a, b) => a.n - b.n);
  result.kept.sort((a, b) => a.n - b.n);
  return result;
}
