"use client";

import { useEffect, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { useOrca } from "@/lib/store";
import { browserSupabase } from "@/lib/supabase/browser";

function zones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return all.includes(current) ? all : [current, ...all];
}

/** Who is signed in, their timezone (every day boundary uses it), and sign out. */
export function AccountCard() {
  // The timezone lives in the store (it sets every day boundary); a failed save shows there.
  const { timezone, setTimezone, hydrated } = useOrca();
  const [email, setEmail] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: auth } = await browserSupabase().auth.getUser();
      if (!live) return;
      if (!auth.user) return setProblem("Couldn't read your account.");
      setEmail(auth.user.email ?? "");
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <Card className="flex flex-col gap-[14px] px-[28px] pb-[24px] pt-[24px]">
      <h2 className="text-[22px] font-bold text-prussian">Account</h2>
      {email !== null && hydrated && (
        <>
          <p data-part="account-email" className="text-[15px] font-semibold text-prussian">
            {email}
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-bold text-prussian">Timezone</span>
            <Select size="sm" label="Timezone" value={timezone} options={zones(timezone)} onChange={setTimezone} />
          </div>
          <p className="-mt-[6px] text-[13px] text-wisteria-deep">Streaks and due dates change over at midnight here.</p>
        </>
      )}
      {problem && <p role="alert" className="text-[13px] font-semibold text-prussian">{problem}</p>}
      <form action={signOut}>
        <Button variant="secondary" size="sm" type="submit">
          Sign out
        </Button>
      </form>
    </Card>
  );
}
