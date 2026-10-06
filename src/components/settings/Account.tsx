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

/** Who is signed in, their sea buddy, their timezone (every day boundary uses it), and sign out. */
export function AccountCard() {
  // The timezone and avatar live in the store; a failed save shows there.
  const { timezone, setTimezone, avatar, setAvatar, name, setName, hydrated } = useOrca();
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState("");
  const [username, setUsername] = useState("");
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
      setUsername(name ?? "");
    })();
    return () => {
      live = false;
    };
  }, [name]);

  const saveUsername = () => {
    try {
      setName(username);
      setNotice("Username saved.");
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't save your username.");
    }
  };

  const requestEmailChange = async () => {
    const value = email?.trim() ?? "";
    if (!value || value === confirmedEmail) return setProblem("Enter a different email address.");
    setChangingEmail(true);
    setProblem(null);
    setNotice(null);
    const { error } = await browserSupabase().auth.updateUser({ email: value }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings` });
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
    <Card className="flex flex-col gap-[14px] px-[28px] pb-[24px] pt-[24px]">
      <h2 className="text-[22px] font-bold text-prussian">Account</h2>
      {email !== null && hydrated && (
        <>
          <div className="flex flex-col gap-[8px]">
            <label className="flex flex-col gap-[5px] text-[14px] font-bold text-prussian">
              Username
              <div className="flex gap-[8px]">
                <input value={username} onChange={(e) => { setUsername(e.target.value); setNotice(null); }} maxLength={80} autoComplete="username" className="min-w-0 flex-1 rounded-[10px] border-2 border-alice-deep bg-parchment px-[10px] py-[8px] text-[14px] font-medium outline-none focus:border-wisteria" />
                <Button size="sm" onClick={saveUsername} disabled={!username.trim() || username.trim() === (name ?? "")}>Save</Button>
              </div>
            </label>
          </div>
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
          <div className="flex flex-col gap-[8px]">
            <span className="text-[14px] font-bold text-prussian">Sea buddy</span>
            <AvatarPicker value={avatar} onChange={setAvatar} compact className="items-start" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-bold text-prussian">Timezone</span>
            <Select size="sm" label="Timezone" value={timezone} options={zones(timezone)} onChange={setTimezone} />
          </div>
        </>
      )}
      {notice && <p role="status" className="text-[13px] font-semibold text-good-deep">{notice}</p>}
      {problem && <p role="alert" className="text-[13px] font-semibold text-prussian">{problem}</p>}
      <form action={signOut}>
        <Button variant="secondary" size="sm" type="submit">
          Sign out
        </Button>
      </form>
    </Card>
  );
}
