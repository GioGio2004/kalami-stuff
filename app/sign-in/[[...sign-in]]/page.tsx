import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/AuthShell";
import { LiveMonitorMock } from "@/components/landing/mockups";
import { Scribble } from "@/components/ui/Scribble";

export default function SignInPage() {
  return (
    <AuthShell
      note="Kalami AntiCheat"
      title={
        <>
          Back to the <Scribble>control room</Scribble>.
        </>
      }
      body="Your courses, your grading queue and every live exam, in one place. Staff accounts are invite-only."
      visual={
        <div className="max-w-lg -rotate-2 rounded-[2rem] bg-card p-5 shadow-[0_30px_60px_-35px_rgba(20,20,20,0.45)]">
          <LiveMonitorMock />
        </div>
      }
    >
      <SignIn fallbackRedirectUrl="/courses" />
    </AuthShell>
  );
}
