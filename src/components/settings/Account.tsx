"use client";

import { useEffect, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { AvatarPicker } from "@/components/auth/AvatarPicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { useOrca } from "@/lib/store";
import { browserSupabase } from "@/lib/supabase/browser";

function zones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return all.includes(current) ? all : [current, ...all];
}

/** How the student shows up: their name and sea buddy, at the top of the Account card. The buddy saves as it changes (the store shows a failed save). */
function ProfileFields() {
  const { avatar, setAvatar, name, setName, hydrated } = useOrca();
  const [username, setUsername] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const value = username ?? name ?? "";

  const saveUsername = () => {
    try {
      setName(value);
      setUsername(null);
      setNotice("Username saved.");
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't save your username.");
    }
  };

  return (
    <div className="flex flex-col gap-[16px]" data-part="profile">
      {hydrated && (
        <>
          <label className="flex flex-col gap-[5px] text-[14px] font-bold text-prussian">
            Username
            <div className="flex gap-[8px]">
              <input value={value} onChange={(e) => { setUsername(e.target.value); setNotice(null); }} maxLength={80} autoComplete="username" className="min-w-0 flex-1 rounded-[10px] border-2 border-alice-deep bg-parchment px-[10px] py-[8px] text-[14px] font-medium outline-none focus:border-wisteria" />
              <Button size="sm" onClick={saveUsername} disabled={!value.trim() || value.trim() === (name ?? "")}>Save</Button>
            </div>
          </label>
          <div className="flex flex-col gap-[8px]">
            <span className="text-[14px] font-bold text-prussian">Sea buddy</span>
            <AvatarPicker value={avatar} onChange={setAvatar} compact className="items-start" />
          </div>
        </>
      )}
      {notice && <p role="status" className="text-[13px] font-semibold text-good-deep">{notice}</p>}
      {problem && <p role="alert" className="text-[13px] font-semibold text-prussian">{problem}</p>}
    </div>
  );
}

/** The student's timezone: every day boundary (what's due today, the streak) uses it. Saves as it changes. */
export function TimezoneRow() {
  const { timezone, setTimezone } = useOrca();
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <div className="flex flex-col gap-[2px]">
        <span className="text-[16px] font-bold text-prussian">Timezone</span>
        <span className="text-[13px] font-medium text-wisteria-deep">Decides when your day starts and what&apos;s due today.</span>
      </div>
      <Select size="sm" label="Timezone" value={timezone} options={zones(timezone)} onChange={setTimezone} />
    </div>
  );
}

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button variant="secondary" size="sm" type="submit">
        Sign out
      </Button>
    </form>
  );
}

/** The Account section: name and sea buddy on top, then the sign-in contacts (email and phone, each changed only once confirmed). */
export function AccountCard() {
  const { hydrated } = useOrca();
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [changingEmail, setChangingEmail] = useState(false);
  const [changingPhone, setChangingPhone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: auth } = await browserSupabase().auth.getUser();
      if (!live) return;
      if (!auth.user) return setProblem("Couldn't read your account.");
      setEmail(auth.user.email ?? "");
      setConfirmedEmail(auth.user.email ?? "");
      setPhone(auth.user.phone ?? "");
    })();
    return () => {
      live = false;
    };
  }, []);

  const requestEmailChange = async () => {
    const value = email?.trim() ?? "";
    if (!value || value === confirmedEmail) return setProblem("Enter a different email address.");
    setChangingEmail(true);
    setProblem(null);
    setNotice(null);
    const { error } = await browserSupabase().auth.updateUser({ email: value }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings?section=account` });
    setChangingEmail(false);
    if (error) return setProblem(error.message);
    setNotice("Check your current and new inboxes to confirm the email change. Your email stays the same until it is confirmed.");
  };

  const requestPhoneChange = async () => {
    const value = phone?.trim() ?? "";
    if (!value) return setProblem("Enter a phone number with its country code, for example +12125551212.");
    setChangingPhone(true);
    setProblem(null);
    setNotice(null);
    const { error } = await browserSupabase().auth.updateUser({ phone: value });
    setChangingPhone(false);
    if (error) return setProblem(error.message);
    setPhoneCode("");
    setNotice("We sent a confirmation code to that phone number. Enter it below to finish the change.");
  };

  const confirmPhoneChange = async () => {
    const value = phone?.trim() ?? "";
    if (!value || !phoneCode.trim()) return setProblem("Enter the phone number and confirmation code.");
    setChangingPhone(true);
    setProblem(null);
    const { error } = await browserSupabase().auth.verifyOtp({ phone: value, token: phoneCode.trim(), type: "phone_change" });
    setChangingPhone(false);
    if (error) return setProblem(error.message);
    setPhoneCode("");
    setNotice("Phone number confirmed.");
  };

  return (
    <Card className="flex flex-col gap-[14px] px-[28px] pb-[24px] pt-[22px]" data-part="account">
      <ProfileFields />
      <div className="border-t border-alice-deep" />
      {email !== null && hydrated && (
        <>
          <div className="flex flex-col gap-[8px]">
            <label className="flex flex-col gap-[5px] text-[14px] font-bold text-prussian">
              Email
              <div className="flex gap-[8px]">
                <input data-part="account-email" value={email} onChange={(e) => { setEmail(e.target.value); setNotice(null); }} type="email" autoComplete="email" aria-label="Email" className="min-w-0 flex-1 rounded-[10px] border-2 border-alice-deep bg-parchment px-[10px] py-[8px] text-[14px] font-medium text-prussian outline-none focus:border-wisteria" />
                <Button size="sm" onClick={() => void requestEmailChange()} disabled={changingEmail || !email?.trim() || email.trim() === confirmedEmail}>Verify</Button>
              </div>
            </label>
            <span className="text-[12px] leading-snug text-wisteria-deep">Changing email requires confirmation from your inbox before it takes effect.</span>
          </div>
          <div className="flex flex-col gap-[8px]">
            <label className="flex flex-col gap-[5px] text-[14px] font-bold text-prussian">
              Phone number
              <div className="flex gap-[8px]">
                <input value={phone ?? ""} onChange={(e) => { setPhone(e.target.value); setPhoneCode(""); setNotice(null); }} type="tel" autoComplete="tel" aria-label="Phone number" placeholder="Add phone number" className="min-w-0 flex-1 rounded-[10px] border-2 border-alice-deep bg-parchment px-[10px] py-[8px] text-[14px] font-medium text-prussian outline-none placeholder:text-wisteria-deep focus:border-wisteria" />
                <Button size="sm" onClick={() => void requestPhoneChange()} disabled={changingPhone || !phone?.trim()}>Send code</Button>
              </div>
            </label>
            {notice?.startsWith("We sent") && (
              <div className="flex gap-[8px]">
                <input value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Confirmation code" className="min-w-0 flex-1 rounded-[10px] border-2 border-alice-deep bg-parchment px-[10px] py-[8px] text-[14px] font-medium outline-none focus:border-wisteria" />
                <Button size="sm" onClick={() => void confirmPhoneChange()} disabled={changingPhone || !phoneCode.trim()}>Confirm</Button>
              </div>
            )}
            <span className="text-[12px] leading-snug text-wisteria-deep">A confirmation code is required before a new phone number is saved.</span>
          </div>
        </>
      )}
      {notice && <p role="status" className="text-[13px] font-semibold text-good-deep">{notice}</p>}
      {problem && <p role="alert" className="text-[13px] font-semibold text-prussian">{problem}</p>}
    </Card>
  );
}
