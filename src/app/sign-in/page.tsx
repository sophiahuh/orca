import { AuthShell } from "@/components/auth/AuthShell";
import { IslandAside } from "@/components/auth/IslandAside";
import { SignInForm } from "@/components/auth/forms";
import { safeNext } from "@/lib/auth/paths";

export const metadata = { title: "Log in · Orca" };

const NOTICES: Record<string, string> = {
  link: "That link didn't work here. If you were confirming your email, try logging in. If you were resetting your password, ask for a new link.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined);
  const notice = typeof sp.notice === "string" ? NOTICES[sp.notice] : undefined;
  return (
    <AuthShell eyebrow="Log in" title="Welcome back" lead="Pick up your islands right where you left off." aside={<IslandAside label="Your islands" />}>
      <SignInForm next={next} notice={notice} />
    </AuthShell>
  );
}
