"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface Status {
  connected: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/**
 * Settings → Claude connector: one secret link per student that Claude calls while they study in a
 * chat (`/api/connector`). The link is shown once; making a new one replaces the old.
 */
export function ClaudeConnectorCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch("/api/connector", { cache: "no-store" });
      if (!live) return;
      if (!res.ok) return setProblem("Couldn't read the connector.");
      setStatus((await res.json()) as Status);
    })();
    return () => {
      live = false;
    };
  }, []);

  const create = async () => {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    try {
      const res = await fetch("/api/connector", { method: "POST" });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) return setProblem(body.error ?? "Couldn't make a connector link.");
      setUrl(body.url);
      setStatus({ connected: true, createdAt: new Date().toISOString(), lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  // Disconnect asks first (as the Canvas card does): the link stops working at once and Claude
  // would need a new one pasted in.
  const [confirming, setConfirming] = useState(false);
  const revoke = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/connector", { method: "DELETE" });
      if (!res.ok) return setProblem("Couldn't disconnect.");
      setConfirming(false);
      setUrl(null);
      setStatus({ connected: false, createdAt: null, lastUsedAt: null });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setProblem("Select the link and copy it by hand.");
    }
  };

  return (
    <Card id="connector" className="flex flex-col gap-[12px] scroll-mt-[24px] px-[24px] pb-[22px] pt-[20px]" data-part="claude-connector">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-bold text-prussian">Claude connector</h2>
        <p className="text-[14px] font-medium text-wisteria-deep">
          Study in Claude as usual. With this connected, Claude knows what each exam covers and what you&apos;re weak on, and every answer it grades goes on your record here.
        </p>
      </div>
      {url ? (
        <div className="flex flex-col gap-[8px]" data-part="connector-link">
          <p className="text-[13px] font-semibold text-prussian">Your link, shown once. In Claude: Settings → Connectors → Add custom connector, paste it as the URL, no sign-in.</p>
          <code className="break-all rounded-[12px] border-2 border-alice-deep bg-alice px-[12px] py-[8px] text-[12px] text-prussian" data-part="connector-url">{url}</code>
          <div className="flex items-center gap-[10px]">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</Button>
            <span className="text-[13px] font-medium text-wisteria-deep">Anyone with this link can read and change your study record. Keep it to yourself.</span>
          </div>
        </div>
      ) : (
        <p className="text-[13px] font-semibold text-prussian" data-part="connector-status">
          {status === null ? "…" : status.connected ? `Connected${status.lastUsedAt ? `, last used ${new Date(status.lastUsedAt).toLocaleDateString()}` : ", not used yet"}.` : "Not connected."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-[10px]">
        <Button size="sm" onClick={() => void create()} disabled={busy || status === null} data-part="connector-create">
          {status?.connected ? "Make a new link" : "Connect Claude"}
        </Button>
        {status?.connected && !confirming && (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy} data-part="connector-revoke">
            Disconnect
          </Button>
        )}
        {problem && <span role="alert" className="text-[13px] font-semibold text-bad-text">{problem}</span>}
      </div>
      {status?.connected && confirming && (
        <div className="flex flex-wrap items-center gap-[10px] rounded-[14px] border-2 border-alice-deep bg-alice px-[14px] py-[10px]" data-part="connector-revoke-confirm">
          <span className="text-[13px] font-semibold text-prussian">Disconnect Claude? The link stops working at once; Claude would need a new one.</span>
          <Button size="sm" variant="danger" onClick={() => void revoke()} disabled={busy} data-part="connector-revoke-yes">
            Yes, disconnect
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy} data-part="connector-revoke-cancel">
            Keep it
          </Button>
        </div>
      )}
    </Card>
  );
}
