"use client";

import { SignInButton, SignOutButton, SignUpButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCurrentUser, type CurrentUser } from "@/components/CurrentUserProvider";
import { Logo } from "@/components/Logo";
import { Enter } from "@/components/motion/Reveal";
import { ArrowButton, ButtonLink, buttonClass } from "@/components/ui/buttons";
import { FormError } from "@/components/ui/form";
import { LoadingScreen, StatusScreen, WritingDots } from "@/components/ui/StatusScreen";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";

type InviteInfo = FunctionReturnType<typeof api.invites.getByToken>;

export function AcceptInvite({ token }: { token: string }) {
  const invite = useQuery(api.invites.getByToken, { token });
  const current = useCurrentUser();
  const accept = useMutation(api.invites.accept);
  const router = useRouter();
  return (
    <InviteScreen
      invite={invite}
      current={current}
      returnTo={`/invite/${token}`}
      onAccept={async () => {
        await accept({ token });
        router.replace("/courses");
      }}
    />
  );
}

/** The invite as a ticket: who it's for, where to, and what to do next. */
export function InviteScreen({
  invite,
  current,
  returnTo,
  onAccept,
}: {
  invite: InviteInfo | undefined;
  current: CurrentUser;
  returnTo: string;
  onAccept: () => Promise<void>;
}) {
  const [now] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    try {
      await onAccept();
    } catch (e) {
      setError(errorMessage(e));
      setPending(false);
    }
  }

  if (invite === undefined) {
    return <LoadingScreen label="Loading invite" />;
  }
  if (invite === null) {
    return (
      <StatusScreen note="Hmm" title="This invite link isn't valid">
        <p>Check that you copied the whole link, or ask for a new invite.</p>
      </StatusScreen>
    );
  }
  if (invite.status === "revoked") {
    return (
      <StatusScreen note="Withdrawn" title="This invite was withdrawn">
        <p>Ask the person who invited you for a new one.</p>
      </StatusScreen>
    );
  }
  if (invite.status === "accepted") {
    return (
      <StatusScreen note="Already done" title="This invite has been used">
        <ButtonLink href="/courses">Open Kalami AntiCheat</ButtonLink>
      </StatusScreen>
    );
  }
  if (invite.expiresAt < now) {
    return (
      <StatusScreen note="Too late, sorry" title="This invite has expired">
        <p>Invites last 14 days. Ask for a new one.</p>
      </StatusScreen>
    );
  }

  const roleLabel = invite.role === "uni_admin" ? "a university admin" : "a lecturer";
  const expires = new Date(invite.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <Enter kind="drop">
          <Link href="/" className="mx-auto block w-fit" aria-label="Kalami AntiCheat">
            <Logo />
          </Link>
        </Enter>

        <Enter kind="scale" delay={0.15} className="mt-8 rounded-[2.5rem] bg-panel p-3">
          <div className="notch-sides rounded-[2.1rem] bg-card [--notch-y:calc(100%_-_5.5rem)]">
            <div className="p-7 sm:p-9">
              <p className="-rotate-2 font-hand text-[1.8rem] leading-none text-graphite">You&apos;re invited!</p>
              <h1 className="mt-4 text-3xl font-medium leading-tight tracking-[-0.035em] sm:text-4xl">
                Join {invite.universityName.en} as {roleLabel}
              </h1>
              <p className="mt-2 text-graphite">{invite.universityName.ka}</p>
            </div>
            <div className="flex h-[5.5rem] items-center gap-6 border-t border-dashed border-ink/15 px-7 sm:px-9">
              <div className="min-w-0">
                <p className="text-xs text-graphite">For</p>
                <p className="truncate font-medium">{invite.email}</p>
              </div>
              <div className="ml-auto shrink-0 text-right">
                <p className="text-xs text-graphite">Valid until</p>
                <p className="font-medium">{expires}</p>
              </div>
            </div>
          </div>
        </Enter>

        <Enter delay={0.5} className="mt-6 space-y-4 px-2">
          {current.status === "signed-out" && (
            <>
              <p className="text-[15px] text-graphite">
                Create your account with <strong className="text-ink">{invite.email}</strong>, or sign
                in if you already have one.
              </p>
              <div className="flex flex-wrap gap-3">
                <SignUpButton
                  forceRedirectUrl={returnTo}
                  signInForceRedirectUrl={returnTo}
                  initialValues={{ emailAddress: invite.email }}
                >
                  <button className={buttonClass("ink")}>Create account</button>
                </SignUpButton>
                <SignInButton
                  forceRedirectUrl={returnTo}
                  signUpForceRedirectUrl={returnTo}
                  initialValues={{ emailAddress: invite.email }}
                >
                  <button className={buttonClass("outline")}>I have an account</button>
                </SignInButton>
              </div>
            </>
          )}
          {current.status === "loading" && <WritingDots label="Checking your account" />}
          {current.status === "error" && <FormError>{current.message}</FormError>}
          {current.status === "ready" &&
            (current.me.email === invite.email ? (
              <ArrowButton tone="lime" onClick={accept} disabled={pending}>
                {pending ? "Accepting…" : "Accept invite"}
              </ArrowButton>
            ) : (
              <>
                <p className="text-[15px] text-graphite">
                  You&apos;re signed in as <strong className="text-ink">{current.me.email}</strong>. Sign
                  out, then sign in with {invite.email} to accept.
                </p>
                <SignOutButton redirectUrl={returnTo}>
                  <button className={buttonClass("outline")}>Sign out</button>
                </SignOutButton>
              </>
            ))}
          {error && <FormError>{error}</FormError>}
        </Enter>
      </div>
    </main>
  );
}
