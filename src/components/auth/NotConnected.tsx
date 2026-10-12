import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { Screen } from "@/components/layout/Screen";
import { Card } from "@/components/ui/Card";

/** Shown instead of the app when Supabase's environment variables are missing. Nothing falls back to the browser. */
export function NotConnected({ message }: { message: string }) {
  return (
    <Screen bg="ocean" className="items-center justify-center px-[16px]">
      <OrcaLogo width={72} shadow={false} />
      <Card className="mt-[24px] flex w-[520px] max-w-full flex-col gap-[10px] px-[32px] py-[28px]">
        <h1 className="text-[28px] font-semibold text-prussian">Orca isn&apos;t connected to its database</h1>
        <p role="alert" className="text-[15px] text-prussian">
          {message}
        </p>
      </Card>
    </Screen>
  );
}
