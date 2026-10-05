"use client";

import { useEffect, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { browserSupabase } from "@/lib/supabase/browser";

type Account = { email: string; userId: string; timezone: string };

function zones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return all.includes(current) ? all : [current, ...all];
}

/** Who is signed in, their timezone (every day boundary uses it), and sign out. */
export function AccountCard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const db = browserSupabase();
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) return live && setProblem("Couldn't read your account.");
      const { data, error } = await db.from("profiles").select("timezone").eq("owner_id", auth.user.id).single();
      if (!live) return;
      if (error) return setProblem(`Couldn't read your profile: ${error.message}`);
      setAccount({ email: auth.user.email ?? "", userId: auth.user.id, timezone: data.timezone });
    })();
    return () => {
      live = false;
    };
  }, []);

  const changeZone = async (timezone: string) => {
    if (!account) return;
    setSaved(false);
    setProblem(null);
    const { error } = await browserSupabase().from("profiles").update({ timezone }).eq("owner_id", account.userId);
    if (error) return setProblem(`Couldn't save: ${error.message}`);
    setAccount({ ...account, timezone });
    setSaved(true);
  };

  return (
    <Card className="flex flex-col gap-[14px] px-[28px] pb-[24px] pt-[24px]">
      <h2 className="text-[22px] font-bold text-prussian">Account</h2>
      {account && (
        <>
          <p data-part="account-email" className="text-[15px] font-semibold text-prussian">
            {account.email}
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-bold text-prussian">Timezone</span>
            <Select size="sm" label="Timezone" value={account.timezone} options={zones(account.timezone)} onChange={changeZone} />
          </div>
          <p className="-mt-[6px] text-[13px] text-wisteria-deep">Streaks and due dates change over at midnight here.</p>
        </>
      )}
      {saved && <p role="status" className="text-[13px] font-semibold text-wisteria-deep">Saved.</p>}
      {problem && <p role="alert" className="text-[13px] font-semibold text-prussian">{problem}</p>}
      <form action={signOut}>
        <Button variant="secondary" size="sm" type="submit">
          Sign out
        </Button>
      </form>
    </Card>
  );
}
