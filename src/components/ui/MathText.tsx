import "katex/dist/katex.min.css";
import { Fragment, useMemo } from "react";
import { renderMath, splitMath } from "@/lib/math-text";

/**
 * Question text with its `\( … \)` and `\[ … \]` math drawn by KaTeX (`src/lib/math-text.ts`).
 * Plain text renders as plain text; math that fails to parse shows its LaTeX source as text, never
 * KaTeX's error markup. The validator refuses such math before it is stored, so that's only for
 * questions written before it did.
 */
export function MathText({ text }: { text: string }) {
  const pieces = useMemo(() => {
    const split = splitMath(text);
    if (!split.some((p) => p.kind === "math")) return null;
    return split.map((p) => {
      if (p.kind === "text") return p;
      try {
        return { ...p, html: renderMath(p.value, p.display) };
      } catch {
        return { kind: "text" as const, value: p.display ? `\\[${p.value}\\]` : `\\(${p.value}\\)` };
      }
    });
  }, [text]);
  if (!pieces) return <>{text}</>;
  return (
    <>
      {pieces.map((p, i) =>
        "html" in p ? (
          // KaTeX's own output for LaTeX the validators passed, trusting no command (no links,
          // no raw HTML, no classes or styles from the text); the one sanctioned use of innerHTML.
          // eslint-disable-next-line react/no-danger
          <span key={i} data-part="math" dangerouslySetInnerHTML={{ __html: p.html }} />
        ) : (
          <Fragment key={i}>{p.value}</Fragment>
        ),
      )}
    </>
  );
}
