import { AuthShell } from "@/components/auth/AuthShell";
import { SignUpForm } from "@/components/auth/forms";

export const metadata = { title: "Create account · Orca" };

export default function SignUpPage() {
  return (
    <AuthShell title="Create your account" lead="Mastery made easy. We'll email you a link to confirm.">
      <SignUpForm />
    </AuthShell>
  );
}
