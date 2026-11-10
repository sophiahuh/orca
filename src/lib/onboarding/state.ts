/**
 * What an account has done with the onboarding tips (profiles.onboarding): the ids of the tips it
 * has seen, and whether it skipped them all. Skipped tips never come back (owner, 2026-11-10). Pure.
 */
import { z } from "zod";

export const OnboardingSchema = z.object({ seen: z.array(z.string()), skipped: z.boolean() });
export type OnboardingState = z.infer<typeof OnboardingSchema>;

/** A new account: nothing seen. */
export const NEW_ONBOARDING: OnboardingState = { seen: [], skipped: false };
/** No tips at all: before the student's data is loaded, and on a database without the column. */
export const TIPS_OFF: OnboardingState = { seen: [], skipped: true };

/** The state with these tips seen too. The same object when none of them is new. */
export function withSeen(state: OnboardingState, ids: readonly string[]): OnboardingState {
  const fresh = ids.filter((id, i) => !state.seen.includes(id) && ids.indexOf(id) === i);
  return fresh.length ? { ...state, seen: [...state.seen, ...fresh] } : state;
}

/**
 * The profile row's value. A database from before the column (a hosted project whose migrations
 * are pushed by hand) sends none: the tips stay off there, since seeing one couldn't be saved.
 */
export function onboardingFromProfile(value: unknown): OnboardingState {
  if (value === undefined) return TIPS_OFF;
  return OnboardingSchema.parse(value);
}
