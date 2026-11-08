"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface Status {
  connected: boolean;
  baseUrl: string | null;
  canvasUser: string | null;
  lastUsedAt: string | null;
}

export const DEFAULT_CANVAS_SITE = "https://courseworks2.columbia.edu";

const field = "h-[40px] w-full rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] text-[14px] font-semibold text-prussian outline-none focus:border-wisteria";

/**
 * Settings → Canvas: the student's Canvas site and access token (`/api/canvas`). Connected, every
 * course can be imported from `/import/canvas` instead of uploaded file by file.
 */
export function CanvasConnectionCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [site, setSite] = useState(DEFAULT_CANVAS_SITE);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch("/api/canvas", { cache: "no-store" });
      if (!live) return;
      if (!res.ok) return setProblem("Couldn't read the Canvas connection.");
      const s = (await res.json()) as Status;
      setStatus(s);
      if (s.baseUrl) setSite(s.baseUrl);
    })();
    return () => {
      live = false;
    };
  }, []);

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/canvas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl: site, token }) });
      const body = (await res.json()) as { canvasUser?: string; error?: string };
      if (!res.ok) return setProblem(body.error ?? "Couldn't connect Canvas.");
      setToken("");
      setStatus({ connected: true, baseUrl: site, canvasUser: body.canvasUser ?? null, lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  // Disconnect asks first: the owner hit it by accident while testing (2026-11-07), and reconnecting
  // needs a new token from Canvas, since the old one is never shown again.
  const [confirming, setConfirming] = useState(false);
  const disconnect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/canvas", { method: "DELETE" });
      if (!res.ok) return setProblem("Couldn't disconnect.");
      setConfirming(false);
      setStatus({ connected: false, baseUrl: null, canvasUser: null, lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-[12px] px-[24px] pb-[22px] pt-[20px]" data-part="canvas-connection">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-bold text-prussian">Canvas</h2>
        <p className="text-[14px] font-medium text-wisteria-deep">Connect CourseWorks and Orca pulls each course&apos;s slides, assignments and exam dates itself. No uploading.</p>
      </div>
      {status?.connected ? (
        <div className="flex flex-col gap-[10px]">
          <p className="text-[13px] font-semibold text-prussian" data-part="canvas-status">
            Connected{status.canvasUser ? ` as ${status.canvasUser}` : ""} to {status.baseUrl}.
          </p>
          <div className="flex flex-wrap items-center gap-[10px]">
            <Link href="/import/canvas" className="pressable inline-flex items-center rounded-[20px] bg-wisteria px-5 py-3 text-[15px] font-bold text-parchment lip-5 lip-wisteria" data-part="canvas-import-link">
              Import a course
            </Link>
            {!confirming && (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy} data-part="canvas-disconnect">
                Disconnect
              </Button>
            )}
          </div>
          {confirming && (
            <div className="flex flex-wrap items-center gap-[10px] rounded-[14px] border-2 border-alice-deep bg-alice px-[14px] py-[10px]" data-part="canvas-disconnect-confirm">
              <span className="text-[13px] font-semibold text-prussian">Disconnect Canvas? Reconnecting needs a new access token from Canvas.</span>
              <Button size="sm" variant="danger" onClick={() => void disconnect()} disabled={busy} data-part="canvas-disconnect-yes">
                Yes, disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy} data-part="canvas-disconnect-cancel">
                Keep it
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-[10px]"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <label className="flex flex-col gap-[4px] text-[12px] font-semibold text-wisteria-deep">
            Canvas site
            <input id="canvas-site" className={field} value={site} onChange={(e) => setSite(e.target.value)} placeholder={DEFAULT_CANVAS_SITE} data-part="canvas-site" />
          </label>
          <label className="flex flex-col gap-[4px] text-[12px] font-semibold text-wisteria-deep">
            Access token
            <input id="canvas-token" className={field} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="Paste the token" data-part="canvas-token" />
          </label>
          <p className="text-[12px] font-medium text-wisteria-deep">
            In Canvas: Account → Settings → Approved Integrations → <b>New Access Token</b>. Orca stores it encrypted and only uses it to read your courses.
          </p>
          <div className="flex items-center gap-[10px]">
            <Button size="sm" type="submit" disabled={busy || status === null || !token.trim()} data-part="canvas-connect">
              {busy ? "Checking…" : "Connect Canvas"}
            </Button>
          </div>
        </form>
      )}
      {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
    </Card>
  );
}
