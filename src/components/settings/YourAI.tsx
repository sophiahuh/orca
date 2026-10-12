"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type LlmConfig, type LlmProvider, PROVIDERS, PROVIDER_ORDER, compatModels, llmReady, modelLabel } from "@/lib/llm";
import { useOrca } from "@/lib/store";
import { IconCheck } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { fadeUp } from "@/lib/motion";
import { useServerModel } from "@/hooks/useServerModel";

type Status = { kind: "idle" } | { kind: "testing" } | { kind: "ok"; count: number } | { kind: "error"; message: string };

const field =
  "h-[40px] w-full rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[12px] text-[15px] font-semibold text-prussian placeholder:font-medium placeholder:text-periwinkle-deep focus:border-wisteria-deep focus:outline-none";

/**
 * Settings → "Your AI": connect the model the student already pays for.
 * The key is kept in this browser only and sent with each extraction or grading request.
 */
export function YourAI() {
  const { llm, setLlm } = useOrca();
  const serverModel = useServerModel();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [models, setModels] = useState<string[]>([]);

  const draft: LlmConfig = llm ?? { provider: "anthropic", model: PROVIDERS.anthropic.defaultModel, apiKey: "" };
  const info = PROVIDERS[draft.provider];
  const update = (patch: Partial<LlmConfig>) => setLlm({ ...draft, ...patch });

  const switchProvider = (provider: LlmProvider) => {
    setModels([]);
    setStatus({ kind: "idle" });
    setLlm({ provider, model: PROVIDERS[provider].defaultModel, apiKey: "", baseUrl: PROVIDERS[provider].baseUrl });
  };

  const test = async () => {
    setStatus({ kind: "testing" });
    try {
      let list: string[];
      if (info.browserOnly) {
        list = await compatModels(draft);
      } else {
        const res = await fetch("/api/llm/models", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: draft.provider, apiKey: draft.apiKey, baseUrl: draft.baseUrl }),
        });
        const data = (await res.json()) as { models?: string[]; error?: string };
        if (!res.ok || !data.models) throw new Error(data.error ?? "Couldn't connect.");
        list = data.models;
      }
      setModels(list);
      setStatus({ kind: "ok", count: list.length });
      if (!draft.model || !list.includes(draft.model)) {
        const preferred = list.find((m) => m === info.defaultModel) ?? list[0];
        if (preferred) update({ model: preferred });
      }
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Couldn't connect." });
    }
  };

  const options = Array.from(new Set([...(models.length ? models : info.suggestedModels), ...(draft.model ? [draft.model] : [])]));
  const labels = Object.fromEntries(options.map((m) => [m, modelLabel(m)]));
  const connected = llmReady(llm);

  return (
    <Card className="flex flex-col gap-[16px] px-[28px] pb-[24px] pt-[24px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-prussian">Your AI</h2>
          <p className="mt-[4px] text-[14px] font-medium text-wisteria-deep">
            {serverModel ? `Orca runs on ${modelLabel(serverModel)} by default. ` : ""}Bring the model you already use if you prefer. Your key stays in this browser.
          </p>
        </div>
        <span
          className={
            "mt-[4px] inline-flex shrink-0 items-center gap-[6px] rounded-pill px-[12px] py-[6px] text-[12px] font-bold " +
            (connected ? "bg-wisteria text-parchment" : "bg-alice text-wisteria-deep")
          }
        >
          {connected && <IconCheck size={12} strokeWidth={4} />}
          {connected ? "Your model" : serverModel ? "Orca's model" : "Demo mode"}
        </span>
      </div>

      <label className="flex flex-col gap-[6px]">
        <span className="text-[14px] font-bold text-prussian">Provider</span>
        <Select
          label="AI provider"
          value={draft.provider}
          options={PROVIDER_ORDER}
          labels={Object.fromEntries(PROVIDER_ORDER.map((p) => [p, PROVIDERS[p].label]))}
          onChange={switchProvider}
          className="self-start"
        />
        <span className="text-[13px] text-wisteria-deep">{info.blurb}</span>
      </label>

      {info.needsKey && (
        <label className="flex flex-col gap-[6px]">
          <span className="flex items-center justify-between text-[14px] font-bold text-prussian">
            API key
            {info.keyUrl && (
              <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-wisteria-deep hover:underline">
                Get a key ↗
              </a>
            )}
          </span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft.apiKey}
            placeholder={info.keyPlaceholder}
            onChange={(e) => update({ apiKey: e.target.value })}
            className={field}
          />
        </label>
      )}

      {info.browserOnly && (
        <label className="flex flex-col gap-[6px]">
          <span className="text-[14px] font-bold text-prussian">Server URL</span>
          <input value={draft.baseUrl ?? ""} onChange={(e) => update({ baseUrl: e.target.value })} className={field} placeholder={info.baseUrl} />
        </label>
      )}

      <div className="flex flex-col gap-[6px]">
        <span className="text-[14px] font-bold text-prussian">Model</span>
        <div className="flex flex-wrap items-center gap-[10px]">
          {options.length > 0 ? (
            <Select label="Model" value={draft.model} options={options} labels={labels} onChange={(model) => update({ model })} />
          ) : (
            <input
              value={draft.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder="Connect to load models, or type one"
              className={field + " max-w-[260px]"}
            />
          )}
          <Button size="sm" variant="ghost" onClick={test} disabled={status.kind === "testing" || (info.needsKey && !draft.apiKey.trim())}>
            {status.kind === "testing" ? "Connecting…" : models.length ? "Refresh models" : "Connect"}
          </Button>
        </div>
        <AnimatePresence mode="wait">
          {status.kind === "ok" && (
            <motion.span key="ok" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="text-[13px] font-semibold text-wisteria-deep">
              Connected. {status.count} model{status.count === 1 ? "" : "s"} available.
            </motion.span>
          )}
          {status.kind === "error" && (
            <motion.span key="err" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="text-[13px] font-semibold text-prussian">
              {status.message}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {llm && (
        <button type="button" onClick={() => setLlm(null)} className="self-start text-[13px] font-semibold text-wisteria-deep hover:underline">
          Disconnect and forget my key
        </button>
      )}
    </Card>
  );
}
