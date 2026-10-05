/** One page's text items joined into lines, the way every reader of Orca's PDFs does it. Pure. */
export function pageText(items: ReadonlyArray<object>): string {
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    if (!("str" in item)) continue;
    const { str, hasEOL } = item as { str: string; hasEOL?: boolean };
    line += str;
    if (hasEOL) {
      lines.push(line);
      line = "";
    } else if (str && !str.endsWith(" ")) {
      line += " ";
    }
  }
  if (line) lines.push(line);
  return lines.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
