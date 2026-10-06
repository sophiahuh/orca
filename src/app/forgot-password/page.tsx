import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotForm } from "@/components/auth/forms";

export const metadata = { title: "Reset password · Orca" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell eyebrow="Forgot password" title="Reset your password" lead="Enter your email and we'll send a link.">
      <ForgotForm />
    </AuthShell>
  );
}
