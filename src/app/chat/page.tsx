"use client";

import { use, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useOrca } from "@/lib/store";
import { PROVIDERS, type ChatTurn, compatChat, llmReady, modelLabel, systemFor } from "@/lib/llm";
import { IconSend, IconUp } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { Wave } from "@/components/brand/Decor";
import { Chip, ContextPill } from "@/components/ui/Chip";
import { RoundButton } from "@/components/ui/RoundButton";
import { ChatBubble, Typing, type ChatMessage } from "@/components/chat/ChatBubble";
import { fadeUp, popIn, stagger } from "@/lib/motion";

export default function ChatPage({ searchParams }: PageProps<"/chat">) {
  const sp = use(searchParams);
  const { courses, llm } = useOrca();
  const courseSlug = typeof sp.course === "string" ? sp.course : undefined;
  const course = courses.find((c) => c.slug === courseSlug) ?? courses[0];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${++seq.current}`;

  const currentTopic = course?.topics.find((t) => t.status === "current")?.name ?? "this week";
  const suggestions = [
    `Quiz me on ${currentTopic}`,
    `Explain ${currentTopic} simply`,
    `Plan my week for ${course?.short ?? "class"}`,
  ];

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatMessage[] = [...messages, { id: nextId("u"), role: "user", content }];
    setMessages(next);
    setInput("");
    setShowSuggestions(false);
    setBusy(true);
    const turns: ChatTurn[] = next.map(({ role, content }) => ({ role, content }));
    const courseCtx = course ? { name: course.name, short: course.short, topics: course.topics.map((t) => ({ name: t.name, status: t.status })) } : null;
    try {
      let reply: string;
      if (llmReady(llm) && PROVIDERS[llm.provider].browserOnly) {
        // Local models (Ollama) are reached straight from the browser; the server can't see localhost.
        reply = await compatChat(llm, systemFor(courseCtx), turns);
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: turns, course: courseCtx, llm: llmReady(llm) ? llm : null }),
        });
        const data = (await res.json()) as { reply?: string; error?: string };
        reply = data.reply ?? data.error ?? "Something went quiet. Try again?";
      }
      setMessages((m) => [...m, { id: nextId("a"), role: "assistant", content: reply }]);
    } catch (error) {
      const why = error instanceof Error ? error.message : "I couldn't reach the server.";
      setMessages((m) => [...m, { id: nextId("a"), role: "assistant", content: `${why} Check Settings → Your AI.` }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const empty = messages.length === 0;

  return (
    <Screen bg="alice" className="h-screen max-h-screen">
      <Wave tone="light" x={110} y={210} width={70} seed={1} />
      <Wave tone="light" x={1010} y={250} width={60} seed={2} />
      <Wave tone="light" x={150} y={680} width={80} seed={3} />

      <header className="flex items-center justify-between px-[28px] pt-[28px]">
        <BackButton />
        <div className="flex items-center gap-[10px]">
          <Link
            href="/settings"
            title="Change model"
            className="pressable inline-flex items-center rounded-pill border-2 border-alice-deep bg-parchment px-[14px] py-[9px] text-[14px] font-bold text-wisteria-deep lip-3 lip-alice"
          >
            {llmReady(llm) ? modelLabel(llm.model) : "Demo mode · connect your AI"}
          </Link>
          {course && <ContextPill>{course.short}</ContextPill>}
        </div>
      </header>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[40px]">
        {empty ? (
          <motion.div variants={stagger(0.1, 0.1)} initial="hidden" animate="show" className="m-auto flex max-w-[900px] flex-col items-center text-center">
            <motion.div variants={popIn}>
              <OrcaLogo width={170} />
            </motion.div>
            <motion.h1 variants={fadeUp} className="mt-[6px] text-[46px] font-bold leading-tight text-prussian">
              What would you like to learn today?
            </motion.h1>
            <motion.div variants={fadeUp} className="mt-[26px] flex flex-wrap justify-center gap-[12px]">
              {suggestions.map((s, i) => (
                <Chip key={s} selected={i === 0} size="sm" onClick={() => send(s)}>
                  {s}
                </Chip>
              ))}
            </motion.div>
          </motion.div>
        ) : (
          <div className="mx-auto flex w-full max-w-[860px] flex-col gap-[16px] py-[24px]">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            <AnimatePresence>{busy && <Typing key="typing" />}</AnimatePresence>
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-[860px] px-[40px] pb-[32px] pt-[12px]">
        <AnimatePresence>
          {!empty && showSuggestions && (
            <motion.div variants={fadeUp} initial="hidden" animate="show" exit="exit" className="mb-[12px] flex flex-wrap gap-[10px]">
              {suggestions.map((s) => (
                <Chip key={s} size="sm" onClick={() => send(s)}>
                  {s}
                </Chip>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-[12px] rounded-[40px] border-[2.5px] border-wisteria bg-parchment py-[10px] pl-[12px] pr-[12px] lip-5 lip-periwinkle"
        >
          <RoundButton size={44} label={showSuggestions ? "Hide suggestions" : "Show suggestions"} onClick={() => setShowSuggestions((v) => !v)} className="rounded-pill">
            <motion.span animate={{ rotate: showSuggestions && !empty ? 180 : 0 }} className="flex">
              <IconUp size={20} />
            </motion.span>
          </RoundButton>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about your classes…"
            aria-label="Message Orca"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-prussian placeholder:text-periwinkle-deep focus:outline-none"
          />
          <RoundButton size={44} tone="wisteria" label="Send" type="submit" disabled={!input.trim() || busy} className="rounded-pill">
            <IconSend size={20} />
          </RoundButton>
        </form>
      </div>
    </Screen>
  );
}
