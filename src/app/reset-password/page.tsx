import { AuthShell } from "@/components/auth/AuthShell";
import { ResetForm } from "@/components/auth/forms";

export const metadata = { title: "New password · Orca" };

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" lead="You're signed in from the email link.">
      <ResetForm />
    </AuthShell>
  );
}
