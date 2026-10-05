"use client";

import Link from "next/link";
import { type ReactNode, useActionState, useEffect, useRef } from "react";
import { type AuthState, requestReset, signIn, signUp, updatePassword } from "@/app/auth/actions";
import { Button } from "@/components/ui/Button";
import { MIN_PASSWORD } from "@/lib/auth/validate";

function Field({ label, name, type = "text", autoComplete, hint }: { label: string; name: string; type?: string; autoComplete: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="eyebrow text-wisteria-deep">{label}</span>
      <input
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        minLength={type === "password" && hint ? MIN_PASSWORD : undefined}
        className="h-[48px] rounded-[14px] border-2 border-periwinkle-deep bg-parchment px-[14px] text-[16px] font-semibold text-prussian focus:outline-none focus:ring-2 focus:ring-wisteria"
      />
      {hint && <span className="text-[13px] text-wisteria-deep">{hint}</span>}
    </label>
  );
}

function Form({ action, submit, children, hideOnNotice }: { action: (s: AuthState, d: FormData) => Promise<AuthState>; submit: string; children: ReactNode; hideOnNotice?: boolean }) {
  const [state, run, pending] = useActionState(action, undefined);
  if (hideOnNotice && state?.notice) return <p role="status" className="rounded-[14px] bg-alice px-[14px] py-[12px] text-[15px] font-semibold text-prussian">{state.notice}</p>;
  return (
    <form action={run} className="flex flex-col gap-[16px]">
      {children}
      {state?.error && (
        <p role="alert" className="text-[14px] font-semibold text-prussian">
          {state.error}
        </p>
      )}
      {state?.notice && (
        <p role="status" className="text-[14px] font-semibold text-wisteria-deep">
          {state.notice}
        </p>
      )}
      <Button type="submit" full disabled={pending}>
        {pending ? "One moment…" : submit}
      </Button>
    </form>
  );
}

const linkClass = "font-bold text-wisteria-deep underline";

export function SignInForm({ next, notice }: { next: string; notice?: string }) {
  return (
    <div className="flex flex-col gap-[16px]">
      {notice && (
        <p role="status" className="rounded-[14px] bg-alice px-[14px] py-[12px] text-[14px] font-semibold text-prussian">
          {notice}
        </p>
      )}
      <Form action={signIn} submit="Sign in">
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
      </Form>
      <p className="flex justify-between text-[14px] text-prussian">
        <Link href="/forgot-password" className={linkClass}>
          Forgot password?
        </Link>
        <span>
          New here?{" "}
          <Link href="/sign-up" className={linkClass}>
            Create an account
          </Link>
        </span>
      </p>
    </div>
  );
}

export function SignUpForm() {
  return (
    <div className="flex flex-col gap-[16px]">
      <Form action={signUp} submit="Create account" hideOnNotice>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters.`} />
        <TimezoneField />
      </Form>
      <p className="text-[14px] text-prussian">
        Already have an account?{" "}
        <Link href="/sign-in" className={linkClass}>
          Sign in
        </Link>
      </p>
    </div>
  );
}

/** The browser's timezone, sent with sign-up so day boundaries (streaks, due dates) match the student's. */
function TimezoneField() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      if (ref.current) ref.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      /* left empty: the profile falls back to UTC and Settings can change it */
    }
  }, []);
  return <input ref={ref} type="hidden" name="timezone" defaultValue="" />;
}

export function ForgotForm() {
  return (
    <div className="flex flex-col gap-[16px]">
      <Form action={requestReset} submit="Send reset link" hideOnNotice>
        <Field label="Email" name="email" type="email" autoComplete="email" />
      </Form>
      <p className="text-[14px] text-prussian">
        <Link href="/sign-in" className={linkClass}>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export function ResetForm() {
  return (
    <Form action={updatePassword} submit="Save new password">
      <Field label="New password" name="password" type="password" autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters.`} />
    </Form>
  );
}
