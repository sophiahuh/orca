import type { ReactNode } from "react";

/**
 * Asking before something that can't be taken back, in the line itself instead of a dialog: the
 * question, then a red confirm and a plain way back ("Remove · Keep"). No underlines (owner,
 * 2026-11-09). Renders inline pieces; the caller's flex row lays them out.
 */
export function InlineConfirm({
  question,
  confirm,
  cancel,
  onConfirm,
  onCancel,
  confirmPart,
  cancelPart,
}: {
  question: ReactNode;
  confirm: string;
  cancel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmPart?: string;
  cancelPart?: string;
}) {
  return (
    <>
      <span className="text-prussian">{question}</span>
      <button type="button" onClick={onConfirm} className="cursor-pointer font-bold text-bad-text" data-part={confirmPart}>
        {confirm}
      </button>
      <button type="button" onClick={onCancel} className="cursor-pointer font-bold text-prussian" data-part={cancelPart}>
        {cancel}
      </button>
    </>
  );
}
