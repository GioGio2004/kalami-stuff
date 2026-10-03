import { SignUp } from "@clerk/nextjs";
import { AuthShell, StepsCard } from "@/components/AuthShell";
import { Scribble } from "@/components/ui/Scribble";

export default function SignUpPage() {
  return (
    <AuthShell
      note="Got an invite?"
      title={
        <>
          Set up your <Scribble>staff</Scribble> account.
        </>
      }
      body="Use the email your invite was sent to. Staff access comes from the invite, not from signing up."
      visual={
        <StepsCard
          title="How staff join"
          done={1}
          steps={[
            { title: "Open your invite link", text: "Sent by your university or the Kalami team." },
            { title: "Create your account", text: "With the exact email the invite names." },
            { title: "Accept and open the studio", text: "Your courses and live exams live there." },
          ]}
        />
      }
    >
      <SignUp fallbackRedirectUrl="/courses" />
    </AuthShell>
  );
}
