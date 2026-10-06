"use client";

import Link from "next/link";
import { type ReactNode, useActionState, useState } from "react";
import { type AuthState, requestReset, signIn, signUp, updatePassword } from "@/app/auth/actions";
import { useAvatarPreview } from "@/components/brand/avatar-preview";
import { AvatarPicker } from "@/components/auth/AvatarPicker";
import { Button } from "@/components/ui/Button";
import type { AvatarId } from "@/lib/avatars";
import { MIN_PASSWORD } from "@/lib/auth/validate";
import { cn } from "@/lib/cn";

/**
 * Figma: Field/Name, Field/Email, Field/Password (12 · Log in, 13 · Sign up): a 16 px label row
 * (with an optional link on the right), a 76 px parchment input with a 3.5 px border that turns
 * wisteria when focused, and "Show" inside a password field.
 */
function Field({ label, name, type = "text", autoComplete, placeholder, hint, trailing, minLength, required = true }: { label: string; name: string; type?: string; autoComplete: string; placeholder?: string; hint?: string; trailing?: ReactNode; minLength?: number; required?: boolean }) {
  const [shown, setShown] = useState(false);
  const password = type === "password";
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-center justify-between">
        <label htmlFor={`field-${name}`} className="text-[16px] font-semibold text-wisteria-deep">
          {label}
        </label>
        {trailing}
      </div>
      <div className="relative">
        <input
          id={`field-${name}`}
          name={name}
          type={password && shown ? "text" : type}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={minLength}
          className={cn(
            "h-[76px] w-full rounded-[24px] border-[3.5px] border-alice-deep bg-parchment px-[26px] text-[24px] font-semibold text-prussian lip-5 lip-alice placeholder:text-periwinkle-deep focus:border-wisteria focus:outline-none focus:lip-periwinkle",
            password && "pr-[90px]",
          )}
        />
        {password && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-pressed={shown}
            className="absolute right-[26px] top-1/2 -translate-y-1/2 text-[16px] font-semibold text-wisteria-deep"
          >
            {shown ? "Hide" : "Show"}
          </button>
        )}
      </div>
      {hint && <span className="text-[14px] text-wisteria-deep">{hint}</span>}
    </div>
  );
}

function Form({ action, submit, children, actions, hideOnNotice, prepare }: { action: (s: AuthState, d: FormData) => Promise<AuthState>; submit: string; children: ReactNode; actions?: ReactNode; hideOnNotice?: boolean; prepare?: (data: FormData) => void }) {
  const [state, run, pending] = useActionState(action, undefined);
  if (hideOnNotice && state?.notice) return <p role="status" className="rounded-[20px] border-2 border-alice-deep bg-parchment px-[22px] py-[18px] text-[17px] font-semibold text-prussian lip-4 lip-alice">{state.notice}</p>;
  return (
    <form
      action={(data) => {
        prepare?.(data);
        run(data);
      }}
      className="flex flex-col gap-[24px]"
    >
      <div className="flex flex-col gap-[20px]">{children}</div>
      {state?.error && (
        <p role="alert" className="text-[15px] font-semibold text-prussian">
          {state.error}
        </p>
      )}
      {state?.notice && (
        <p role="status" className="text-[15px] font-semibold text-wisteria-deep">
          {state.notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-[14px]">
        <Button type="submit" disabled={pending}>
          {pending ? "One moment…" : submit}
        </Button>
        {actions}
      </div>
    </form>
  );
}

const linkClass = "text-[16px] font-semibold text-wisteria-deep hover:underline";

function GhostLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="pressable inline-flex items-center justify-center rounded-[20px] border-[2.5px] border-periwinkle-deep bg-parchment px-8 py-4 text-[17px] font-bold leading-none text-wisteria-deep lip-5 lip-periwinkle">
      {children}
    </Link>
  );
}

export function SignInForm({ next, notice }: { next: string; notice?: string }) {
  return (
    <div className="flex flex-col gap-[16px]">
      {notice && (
        <p role="status" className="rounded-[20px] border-2 border-alice-deep bg-parchment px-[22px] py-[16px] text-[15px] font-semibold text-prussian lip-4 lip-alice">
          {notice}
        </p>
      )}
      <Form action={signIn} submit="Log in" actions={<GhostLink href="/sign-up">Create an account</GhostLink>}>
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@school.edu" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          trailing={
            <Link href="/forgot-password" className={linkClass}>
              Forgot password?
            </Link>
          }
        />
      </Form>
    </div>
  );
}

export function SignUpForm() {
  const { preview, setPreview } = useAvatarPreview();
  return (
    <Form action={signUp} submit="Sign up" hideOnNotice actions={<GhostLink href="/sign-in">I have an account</GhostLink>} prepare={withTimezone}>
      <Field label="Name" name="name" autoComplete="name" placeholder="Your name" required={false} />
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@school.edu" />
      <Field label="Password" name="password" type="password" autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} minLength={MIN_PASSWORD} />
      <input type="hidden" name="avatar" value={preview} readOnly />
      {/* The picker sits in the aside on wide screens (SignUpAside); here for narrow ones. */}
      <div className="md:hidden">
        <AvatarPicker value={preview} onChange={setPreview} compact />
      </div>
    </Form>
  );
}

/** The sign-up screen's right side: the avatar picker, sharing its choice with the form and the top bar. */
export function SignUpAside() {
  const { preview, setPreview } = useAvatarPreview();
  return (
    <div className="hidden md:block">
      <AvatarPicker value={preview} onChange={setPreview as (a: AvatarId) => void} />
    </div>
  );
}

/**
 * The browser's timezone, added at submit time so day boundaries (streaks, due dates) match the
 * student's. Read when the form is sent, not into a hidden field: React resets a form's fields
 * after an action answers (a rejected password), which emptied a field set once on mount.
 */
function withTimezone(data: FormData) {
  try {
    data.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    /* left out: the profile falls back to UTC and Settings can change it */
  }
}

export function ForgotForm() {
  return (
    <Form action={requestReset} submit="Send reset link" hideOnNotice actions={<GhostLink href="/sign-in">Back to log in</GhostLink>}>
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@school.edu" />
    </Form>
  );
}

export function ResetForm() {
  return (
    <Form action={updatePassword} submit="Save new password">
      <Field label="New password" name="password" type="password" autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} minLength={MIN_PASSWORD} />
    </Form>
  );
}
