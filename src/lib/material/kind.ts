/**
 * The kinds of file Orca reads, told apart by name and type (in the browser and the upload route)
 * or by their first bytes (when the server reads the stored file). Pure, and safe in the browser.
 */

export const UPLOAD_MIMES = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

export type UploadKind = keyof typeof UPLOAD_MIMES;

/** What the student says the file is (its name or its type), or null for a kind Orca can't read. */
export function uploadKind(filename: string, mime: string): UploadKind | null {
  if (mime === UPLOAD_MIMES.pdf || /\.pdf$/i.test(filename)) return "pdf";
  if (mime === UPLOAD_MIMES.pptx || /\.pptx$/i.test(filename)) return "pptx";
  return null;
}

/** The message for a file of a kind Orca can't read. */
export const UNSUPPORTED_UPLOAD = "Orca can read PDFs and PowerPoint (.pptx) decks. Save older .ppt files as .pptx, or export as PDF.";
