/** Zoom out, zoom in and fit-to-screen buttons, for a pannable canvas (the courses map, the Atlas). */
function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="pressable inline-flex h-[36px] w-[36px] items-center justify-center rounded-[10px] border-2 border-alice-deep bg-parchment text-[18px] font-bold text-prussian lip-2 lip-alice">
      {children}
    </button>
  );
}

export function ZoomControls({ onZoomOut, onZoomIn, onFit, className }: { onZoomOut: () => void; onZoomIn: () => void; onFit: () => void; className?: string }) {
  return (
    <div className={className ?? "flex gap-[8px]"} role="group" aria-label="Zoom">
      <ZoomButton label="Zoom out" onClick={onZoomOut}>
        −
      </ZoomButton>
      <ZoomButton label="Zoom in" onClick={onZoomIn}>
        +
      </ZoomButton>
      <ZoomButton label="Fit to screen" onClick={onFit}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
        </svg>
      </ZoomButton>
    </div>
  );
}
