"use client";

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { MATERIAL_TYPES, type MaterialType, formatUSDate, toISODate } from "@/lib/data";
import { useOrca } from "@/lib/store";
import { IconCalendar, IconUpload } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, ContextPill } from "@/components/ui/Chip";
import { Toggle } from "@/components/ui/Toggle";
import { cn } from "@/lib/cn";
import { fadeUp, stagger } from "@/lib/motion";

const SKELETON = [92, 100, 78, 96, 60, 0, 100, 88, 94, 70, 0, 90, 84];

function DateField({ label, value, onChange, noneLabel }: { label: string; value: string | null; onChange: (v: string | null) => void; noneLabel: string }) {
  const [last, setLast] = useState(value ?? toISODate(new Date()));
  const none = value === null;
  return (
    <div className="flex items-center gap-[12px]">
      <label
        className={cn(
          "pressable relative inline-flex h-[44px] items-center gap-[10px] rounded-[14px] border-[2.5px] px-[14px] text-[15px] font-bold lip-4",
          none ? "border-alice-deep bg-alice text-periwinkle-deep lip-alice" : "border-periwinkle-deep bg-parchment text-prussian lip-periwinkle",
        )}
      >
        <IconCalendar size={20} />
        <span>{formatUSDate(none ? last : value)}</span>
        <input
          type="date"
          aria-label={label}
          value={none ? last : value}
          onChange={(e) => {
            if (!e.target.value) return;
            setLast(e.target.value);
            onChange(e.target.value);
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <Chip tone="outline" size="sm" selected={none} onClick={() => onChange(none ? last : null)}>
        {noneLabel}
      </Chip>
    </div>
  );
}

export default function AddMaterialPage({ searchParams }: PageProps<"/add-material">) {
  const sp = use(searchParams);
  const router = useRouter();
  const { courses, addMaterial } = useOrca();
  const courseSlug = typeof sp.course === "string" ? sp.course : undefined;
  const course = courses.find((c) => c.slug === courseSlug) ?? courses[0];

  const [filename, setFilename] = useState(`${course?.short.replace(/\s+/g, "_") ?? "Course"}_HW3.pdf`);
  const [type, setType] = useState<MaterialType>("Homework");
  const [assigned, setAssigned] = useState<string | null>("2026-09-24");
  const [due, setDue] = useState<string | null>("2026-10-01");
  const [reflect, setReflect] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!course) return null;

  const submit = () => {
    addMaterial({ courseId: course.id, filename, type, assigned, due, reflect });
    router.push(due ? "/calendar" : "/home");
  };

  return (
    <Screen bg="alice" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton />
        <h1 className="text-[44px] font-bold leading-none text-prussian">Add material</h1>
        <ContextPill className="ml-[8px]">{course.short}</ContextPill>
      </header>

      <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex flex-wrap items-start gap-[40px] px-[40px] pb-[48px] pt-[32px]">
        {/* Document preview / drop target */}
        <motion.div variants={fadeUp} className="w-[440px] max-w-full">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFilename(f.name);
            }}
          />
          <Card
            radius={20}
            lip={6}
            role="button"
            tabIndex={0}
            aria-label="Choose a file"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            className="pressable flex min-h-[560px] cursor-pointer flex-col gap-[14px] px-[24px] pb-[28px] pt-[22px]"
          >
            <div className="flex items-center justify-between">
              <span className="truncate text-[15px] font-bold text-prussian">{filename}</span>
              <span className="flex items-center gap-1 text-[13px] font-semibold text-wisteria-deep">
                <IconUpload size={16} /> Replace
              </span>
            </div>
            <div className="mt-[6px] flex flex-col gap-[9px]" aria-hidden>
              {SKELETON.slice(0, 5).map((w, i) => (
                <span key={i} className="block h-[8px] rounded-pill bg-alice-deep" style={{ width: `${w}%`, opacity: w ? 1 : 0 }} />
              ))}
              <span className="my-[6px] block h-[120px] rounded-[12px] bg-alice" />
              {SKELETON.slice(6).map((w, i) => (
                <span key={i} className="block h-[8px] rounded-pill bg-alice-deep" style={{ width: `${w}%`, opacity: w ? 1 : 0 }} />
              ))}
            </div>
          </Card>
        </motion.div>

        {/* Form */}
        <div className="flex w-[560px] max-w-full flex-col gap-[28px]">
          <motion.section variants={fadeUp} className="flex flex-col gap-[14px]">
            <h2 className="text-[17px] font-bold text-prussian">What kind of material is this?</h2>
            <div className="flex flex-wrap gap-[10px]">
              {MATERIAL_TYPES.map((t) => (
                <Chip key={t} tone="outline" size="sm" selected={type === t} onClick={() => setType(t)}>
                  {t}
                </Chip>
              ))}
            </div>
          </motion.section>

          <motion.section variants={fadeUp} className="flex flex-col gap-[12px]">
            <h2 className="text-[17px] font-bold text-prussian">When was it assigned?</h2>
            <DateField label="Assigned date" value={assigned} onChange={setAssigned} noneLabel="Not assigned" />
          </motion.section>

          <motion.section variants={fadeUp} className="flex flex-col gap-[12px]">
            <h2 className="text-[17px] font-bold text-prussian">When is it due?</h2>
            <DateField label="Due date" value={due} onChange={setDue} noneLabel="No due date" />
          </motion.section>

          <motion.div variants={fadeUp}>
            <Card radius={18} lip={4} className="flex items-center gap-[16px] px-[18px] py-[14px]">
              <Toggle checked={reflect} onChange={setReflect} label="Reflect and annotate when I finish" />
              <div className="flex flex-col">
                <span className="text-[15px] font-bold text-prussian">Reflect and annotate when I finish</span>
                <span className="text-[13px] font-medium text-wisteria-deep">Homework only. Orca will ask what tripped you up.</span>
              </div>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp}>
            <Button full onClick={submit}>
              Add to {course.short}
            </Button>
          </motion.div>
        </div>
      </motion.div>
    </Screen>
  );
}
