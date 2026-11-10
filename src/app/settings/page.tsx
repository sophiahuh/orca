"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useOrca } from "@/lib/store";
import { browserSupabase } from "@/lib/supabase/browser";
import { cn } from "@/lib/cn";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Avatar } from "@/components/brand/Avatar";
import { Card } from "@/components/ui/Card";
import { ConfigRow, REVIEW_LABELS } from "@/components/config/ConfigRow";
import { MarkerNotes } from "@/components/config/MarkerNotes";
import { NotesForOrca } from "@/components/config/NotesForOrca";
import { AccountCard, ProfileCard, SignOutButton, TimezoneRow } from "@/components/settings/Account";
import { CanvasConnectionCard } from "@/components/settings/CanvasConnection";
import { ClaudeConnectorCard } from "@/components/settings/ClaudeConnector";
import { fadeSwap, fadeUp, stagger } from "@/lib/motion";
import { Button } from "@/components/ui/Button";

async function saveAccountNotes(notes: string | null) {
  const response = await fetch("/api/account-notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes }) });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Orca couldn't save your notes.");
}

async function saveMarkerNotes(markers: string | null) {
  const response = await fetch("/api/marker-notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ markers }) });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Orca couldn't save how you mark your notes.");
}

/**
 * Settings, one section at a time (owner, 2026-11-10: grouped by what a student comes to do). The
 * section is in the URL (`?section=`), so other screens can link straight to one. Your metrics moved
 * to the home page's stats strip (src/components/map/StudyStats.tsx).
 */
const SECTIONS = [
  { key: "preferences", label: "Preferences", blurb: "How Orca studies with you, in every class unless a class's own settings say otherwise." },
  { key: "connections", label: "Connections", blurb: "Study in Claude, and pull your classes from Canvas." },
  { key: "profile", label: "Profile", blurb: "How you show up in Orca." },
  { key: "account", label: "Account", blurb: "How you sign in." },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

export default function SettingsPage() {
  return (
    <Screen bg="ocean" className="h-screen-below-bar">
      <header className="flex items-center gap-[12px] px-[24px] pt-[20px]">
        <BackButton />
        <h1 className="text-[46px] font-bold leading-none text-prussian">Settings</h1>
      </header>
      <Suspense>
        <SettingsBody />
      </Suspense>
    </Screen>
  );
}

function SettingsBody() {
  const asked = useSearchParams().get("section");
  const section = SECTIONS.find((s) => s.key === asked) ?? SECTIONS[0];

  return (
    <div className="flex min-h-0 flex-1 gap-[20px] px-[24px] pb-[28px] pt-[20px]">
      <SectionRail current={section.key} />
      <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-[14px]", section.key === "preferences" ? "max-w-[1000px]" : "max-w-[720px]")} data-part="settings-section" data-section={section.key}>
        <div className="flex flex-col gap-[4px] px-[4px]">
          <h2 className="text-[28px] font-semibold leading-tight text-prussian">{section.label}</h2>
          <p className="text-[15px] font-medium text-wisteria-deep">{section.blurb}</p>
        </div>
        {/* Only the section scrolls; the padding keeps the cards' lips and the last card clear of the edge. */}
        <div className="-mx-[8px] min-h-0 flex-1 overflow-y-auto px-[8px] pb-[12px]" data-part="settings-scroll">
          <AnimatePresence mode="wait">
            <motion.div key={section.key} variants={fadeSwap} initial="hidden" animate="show" exit="exit" className="flex flex-col gap-[14px]">
              {section.key === "preferences" && (
                <div className="flex items-start gap-[14px]">
                  <div className="flex min-w-0 flex-1 flex-col gap-[14px]">
                    <StudyNotes />
                  </div>
                  <div className="w-[340px] shrink-0">
                    <ReviewRhythm />
                  </div>
                </div>
              )}
              {section.key === "connections" && (
                <>
                  <ClaudeConnectorCard />
                  <CanvasConnectionCard />
                </>
              )}
              {section.key === "profile" && <ProfileCard />}
              {section.key === "account" && <AccountCard />}
            </motion.div>
          </AnimatePresence>
        </div>
        {/* "Your AI" (src/components/settings/YourAI.tsx) is hidden: model calls run on the server with
            Orca's key only (Phase 4, decision 9). Its code stays until "Bring-your-own model" is decided. */}
      </main>
    </div>
  );
}

/** Who's signed in, the sections, and Sign out at the bottom; as tall as the screen. */
function SectionRail({ current }: { current: SectionKey }) {
  const { avatar, name } = useOrca();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void browserSupabase()
      .auth.getUser()
      .then(({ data }) => live && setEmail(data.user?.email ?? null));
    return () => {
      live = false;
    };
  }, []);

  return (
    <Card className="flex w-[260px] shrink-0 flex-col overflow-y-auto gap-[14px] px-[16px] pb-[18px] pt-[18px]" lip={6} radius={28}>
      <div className="flex items-center gap-[10px] px-[6px]" data-part="settings-identity">
        <Avatar creature={avatar} size={44} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[16px] font-bold text-prussian">{name || "You"}</span>
          {email && <span className="truncate text-[12px] font-medium text-wisteria-deep">{email}</span>}
        </div>
      </div>
      <motion.nav variants={stagger(0, 0.04)} initial="hidden" animate="show" aria-label="Settings sections" className="flex flex-col gap-[4px]">
        {SECTIONS.map((s) => (
          <motion.div key={s.key} variants={fadeUp}>
            <Link
              href={`/settings?section=${s.key}`}
              replace
              scroll={false}
              aria-current={s.key === current ? "page" : undefined}
              data-part="settings-tab"
              data-section={s.key}
              className={cn(
                "block rounded-[14px] px-[12px] py-[9px] text-[16px] font-bold transition-colors",
                s.key === current ? "bg-alice text-prussian" : "text-wisteria-deep hover:bg-alice/60 hover:text-prussian",
              )}
            >
              {s.label}
            </Link>
          </motion.div>
        ))}
      </motion.nav>
      <div className="mt-auto border-t border-alice-deep px-[6px] pt-[14px]">
        <SignOutButton />
      </div>
    </Card>
  );
}

/** The account's default review settings and the timezone, beside the notes in Preferences; each saves as it changes. */
function ReviewRhythm() {
  const { defaultConfig, setDefaults, hydrated } = useOrca();
  // Only once loaded: an edit made before the load lands would be overwritten on screen by it.
  if (!hydrated) return null;
  return (
    <Card className="flex flex-col gap-[16px] px-[22px] pb-[22px] pt-[20px]" data-part="default-config">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-bold text-prussian">Review rhythm</h2>
        <p className="text-[13px] font-medium text-wisteria-deep">How long and how often. Changes save as you make them.</p>
      </div>
      <motion.div variants={stagger(0, 0.05)} initial="hidden" animate="show" className="flex flex-col gap-[14px]">
        {(["quick", "deep", "exam"] as const).map((k) => (
          <ConfigRow key={k} stacked label={REVIEW_LABELS[k]} row={defaultConfig[k]} onChange={(row) => setDefaults({ ...defaultConfig, [k]: row })} />
        ))}
      </motion.div>
      <div className="border-t border-alice-deep pt-[16px]">
        <TimezoneRow />
      </div>
    </Card>
  );
}

/** Notes for Orca (every class) and how the student marks confusion; saved together by the Save under them. */
function StudyNotes() {
  const { accountNotes, markerNotes, refresh, hydrated } = useOrca();
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [markersDraft, setMarkersDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    setSaved(false);
    setProblem(null);
    setSaving(true);
    try {
      if (notesDraft !== null) {
        await saveAccountNotes(notesDraft.trim() || null);
        setNotesDraft(null);
      }
      if (markersDraft !== null) {
        await saveMarkerNotes(markersDraft.trim() || null);
        setMarkersDraft(null);
      }
      await refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Orca couldn't save your notes.");
      return;
    } finally {
      setSaving(false);
    }
    setSaved(true);
  };

  if (!hydrated) return null;
  const changed = notesDraft !== null || markersDraft !== null;
  return (
    <>
      <NotesForOrca scope="account" value={notesDraft ?? accountNotes ?? ""} onChange={(v) => { setNotesDraft(v); setSaved(false); }} />
      <MarkerNotes value={markersDraft ?? markerNotes ?? ""} onChange={(v) => { setMarkersDraft(v); setSaved(false); }} />
      <div className="flex items-center justify-end gap-[12px]">
        {problem && <span role="alert" className="text-[14px] font-semibold text-bad-text">{problem}</span>}
        {saved && <span role="status" aria-label="Saved" className="text-[14px] font-semibold text-good-deep">Saved</span>}
        <Button size="sm" onClick={() => void save()} disabled={saving || !changed}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </>
  );
}
