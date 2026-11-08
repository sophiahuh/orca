/**
 * Math in question text: the writing steps put LaTeX between `\( … \)` (inline) or `\[ … \]`
 * (display); everything else is plain text. `splitMath` cuts a string into those pieces,
 * `mathProblem` is the validator's check that every piece renders, and `renderMath` turns one piece
 * into KaTeX's HTML for `MathText`. KaTeX trusts no command, so `\href`, `\url`,
 * `\includegraphics` and `\htmlClass`-style commands draw as red source text, never as links or
 * markup, and the validator refuses math that uses one.
 * Pure; loads under plain Node.
 */
import katex from "katex";

export type MathPiece = { kind: "text"; value: string } | { kind: "math"; value: string; display: boolean };

const OPEN = /\\\(|\\\[/g;

/** Text and math pieces in order. An opening delimiter with no closing one stays text. */
export function splitMath(text: string): MathPiece[] {
  const out: MathPiece[] = [];
  let at = 0;
  let buf = "";
  OPEN.lastIndex = 0;
  for (let m = OPEN.exec(text); m; m = OPEN.exec(text)) {
    const display = m[0] === "\\[";
    const close = text.indexOf(display ? "\\]" : "\\)", m.index + 2);
    if (close < 0) break;
    buf += text.slice(at, m.index);
    if (buf) out.push({ kind: "text", value: buf });
    buf = "";
    out.push({ kind: "math", value: text.slice(m.index + 2, close).trim(), display });
    at = close + 2;
    OPEN.lastIndex = at;
  }
  buf += text.slice(at);
  if (buf) out.push({ kind: "text", value: buf });
  return out;
}

/** Whether the text has any math to render; plain text skips KaTeX entirely. */
export const hasMath = (text: string) => splitMath(text).some((p) => p.kind === "math");

const OPTIONS = { throwOnError: true, strict: "ignore", maxSize: 10, maxExpand: 200, output: "htmlAndMathml" } as const;

/** KaTeX's HTML for one math piece; throws when it doesn't parse. `untrusted` hears each command refused. */
export function renderMath(tex: string, display: boolean, untrusted?: (command: string) => void): string {
  return katex.renderToString(tex, {
    ...OPTIONS,
    displayMode: display,
    trust: (ctx) => {
      untrusted?.(ctx.command);
      return false;
    },
  });
}

/** Why the text's math can't be shown (an unclosed delimiter or LaTeX KaTeX can't parse), or null. */
export function mathProblem(text: string): string | null {
  const pieces = splitMath(text);
  for (const p of pieces) {
    if (p.kind === "text") {
      if (/\\[()[\]]/.test(p.value)) return "has a math delimiter that isn't closed";
      continue;
    }
    if (!p.value) return "has empty math";
    let refused: string | null = null;
    try {
      renderMath(p.value, p.display, (c) => (refused ??= c));
    } catch (e) {
      return `has math that doesn't render (${(e instanceof Error ? e.message : String(e)).replace(/^KaTeX parse error: /, "").slice(0, 80)})`;
    }
    if (refused) return `has math using ${refused}, which isn't allowed`;
  }
  return null;
}
