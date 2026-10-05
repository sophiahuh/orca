import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "@/components/auth/forms";
import { safeNext } from "@/lib/auth/paths";

export const metadata = { title: "Sign in · Orca" };

const NOTICES: Record<string, string> = {
  link: "That link didn't work here. If you were confirming your email, try signing in. If you were resetting your password, ask for a new link.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined);
  const notice = typeof sp.notice === "string" ? NOTICES[sp.notice] : undefined;
  return (
    <AuthShell title="Welcome back" lead="Sign in to pick up where you left off.">
      <SignInForm next={next} notice={notice} />
    </AuthShell>
  );
}
