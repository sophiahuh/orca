import { AuthShell } from "@/components/auth/AuthShell";
import { SignUpAside, SignUpForm } from "@/components/auth/forms";

export const metadata = { title: "Sign up · Orca" };

export default function SignUpPage() {
  return (
    <AuthShell eyebrow="Sign up" title="Join Orca" lead="Turn every class into an island. It takes under a minute." aside={<SignUpAside />}>
      <SignUpForm />
    </AuthShell>
  );
}
