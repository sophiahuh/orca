"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Course, Material } from "@/lib/data";
import { objectivesOnPage } from "@/lib/course/slides";
import { canFlagHard } from "@/lib/mastery/flags";
import { overlayFade, popIn } from "@/lib/motion";
import { useMasteryByCourse, useOrca } from "@/lib/store";
import { browserSupabase } from "@/lib/supabase/browser";
import { IconClose } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { RoundButton } from "@/components/ui/RoundButton";
import { cn } from "@/lib/cn";

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } }> };

/** One page of a PDF drawn as a thumbnail once it scrolls into view. */
function Thumb({ doc, n }: { doc: PdfDoc; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let drawn = false;
    const io = new IntersectionObserver((entries) => {
      if (drawn || !entries.some((e) => e.isIntersecting)) return;
      drawn = true;
      void doc.getPage(n).then((page) => {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 150 / base.width });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (ctx) void page.render({ canvas, canvasContext: ctx, viewport }).promise.catch(() => undefined);
      });
    });
    io.observe(canvas);
    return () => io.disconnect();
  }, [doc, n]);
  return <canvas ref={ref} className="h-auto w-[150px] rounded-[8px] bg-alice" aria-hidden />;
}

/** A material's pages: a PDF drawn from its stored file, or a .pptx's slide titles and first lines (no rendered pages). */
function usePages(material: Material) {
  const pptx = material.filename.toLowerCase().endsWith(".pptx");
  const [state, setState] = useState<{ doc: PdfDoc | null; lines: Array<{ n: number; title: string; line: string }> | null; count: number; error: string | null }>({ doc: null, lines: null, count: 0, error: null });
  useEffect(() => {
    let alive = true;
    const db = browserSupabase();
    (async () => {
      if (pptx) {
        const { data, error } = await db.from("material_pages").select("n, text").eq("material_id", material.id).order("n");
        if (error) throw new Error(error.message);
        const lines = data.map((p) => {
          const [title = `Slide ${p.n}`, line = ""] = p.text.split("\n").map((l) => l.trim()).filter(Boolean);
          return { n: p.n, title, line };
        });
        if (alive) setState({ doc: null, lines, count: lines.length, error: null });
        return;
      }
      if (!material.storagePath) throw new Error("Orca has no file for this material.");
      const { data: blob, error } = await db.storage.from("materials").download(material.storagePath);
      if (error || !blob) throw new Error(error?.message ?? "the file couldn't be downloaded");
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const doc = (await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise) as unknown as PdfDoc;
      if (alive) setState({ doc, lines: null, count: doc.numPages, error: null });
    })().catch((e: unknown) => alive && setState((s) => ({ ...s, error: `Orca couldn't open this file: ${e instanceof Error ? e.message : String(e)}` })));
    return () => {
      alive = false;
    };
  }, [material.id, material.storagePath, pptx]);
  return state;
}

/**
 * "Which slides were hard?" (weak points first, Plan C): the material's pages as a grid (a .pptx as a
 * list of its slides); tapping pages and Flag records a struggle flag (source `slide`) on every
 * objective of the topics each page teaches (`objectivesOnPage`: whole topics, wherever their
 * objectives are taught), except ones already being learned. A page with nothing to flag can't be tapped.
 */
export function HardSlides({ course, material, open, onClose }: { course: Course; material: Material; open: boolean; onClose: () => void }) {
  const { objectives, flagSlides } = useOrca();
  const mastery = useMasteryByCourse()[course.id];
  const pages = usePages(material);
  const [selected, setSelected] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const catalogue = objectives[course.id];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** Per page: the objectives a tap flags, and why a page can't be tapped. */
  const pageInfo = useMemo(() => {
    const info = new Map<number, { ids: string[]; why: string | null }>();
    for (let n = 1; n <= pages.count; n++) {
      const all = objectivesOnPage(material.id, n, catalogue ?? {}, course.topics);
      const ids = all.filter((id) => canFlagHard(mastery?.objectives.get(id)?.status ?? "unseen"));
      info.set(n, { ids, why: all.length === 0 ? "Nothing Orca tracks is taught here" : ids.length === 0 ? "Already in review" : null });
    }
    return info;
  }, [pages.count, material.id, catalogue, course.topics, mastery]);

  const toggle = (n: number) => setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n].sort((a, b) => a - b)));
  const flag = () => {
    flagSlides(course.id, material.id, selected.map((page) => ({ page, objectiveIds: pageInfo.get(page)?.ids ?? [] })));
    setSelected([]);
    setDone(true);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hard-slides-title"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90vh] w-[900px] max-w-full flex-col gap-[16px] rounded-[32px] bg-parchment px-[32px] pb-[24px] pt-[28px] lip-8 lip-alice"
            data-part="hard-slides-modal"
          >
            <RoundButton size={44} label="Close" onClick={onClose} className="absolute right-[24px] top-[24px]">
              <IconClose size={20} />
            </RoundButton>
            <div className="flex flex-col gap-[4px] pr-[48px]">
              <h2 id="hard-slides-title" className="text-[26px] font-bold text-prussian">
                Which slides were hard?
              </h2>
              <p className="text-[14px] font-medium text-wisteria-deep">{material.filename}: tap the ones you struggled with, and Orca will practise what they teach.</p>
            </div>
            {pages.error && (
              <p role="alert" className="text-[14px] font-semibold text-bad-text">
                {pages.error}
              </p>
            )}
            {done && (
              <p role="status" className="text-[14px] font-semibold text-good-deep" data-part="slides-flagged">
                Orca will practise these with you.
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className={cn("grid gap-[12px]", pages.lines ? "grid-cols-1" : "grid-cols-5")}>
                {Array.from({ length: pages.count }, (_, i) => i + 1).map((n) => {
                  const info = pageInfo.get(n);
                  const on = selected.includes(n);
                  const line = pages.lines?.find((l) => l.n === n);
                  return (
                    <button
                      key={n}
                      type="button"
                      disabled={!!info?.why}
                      title={info?.why ?? undefined}
                      aria-pressed={on}
                      onClick={() => toggle(n)}
                      data-part="slide-tile"
                      data-page={n}
                      className={cn(
                        "pressable flex flex-col gap-[6px] rounded-[14px] border-2 p-[8px] text-left",
                        on ? "border-wisteria-deep bg-periwinkle" : "border-alice-deep bg-alice",
                        info?.why && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {pages.doc && <Thumb doc={pages.doc} n={n} />}
                      {line ? (
                        <span className="flex flex-col">
                          <span className="text-[15px] font-bold text-prussian">
                            {n}. {line.title}
                          </span>
                          {line.line && <span className="text-[13px] text-prussian/70">{line.line}</span>}
                        </span>
                      ) : (
                        <span className="text-[13px] font-bold text-prussian">Slide {n}</span>
                      )}
                      {info?.why && <span className="text-[12px] text-prussian/70">{info.why}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-[12px]">
              <Button size="sm" onClick={flag} disabled={selected.length === 0} data-part="flag-slides">
                {selected.length === 0 ? "Flag slides" : `Flag ${selected.length} slide${selected.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
