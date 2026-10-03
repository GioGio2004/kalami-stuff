"use client";

import { SignOutButton } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { useCurrentUser } from "@/components/CurrentUserProvider";
import { ButtonLink, buttonClass } from "@/components/ui/buttons";
import { LoadingScreen, StatusScreen } from "@/components/ui/StatusScreen";
import { STUDENT_APP_URL } from "@/lib/urls";

/**
 * Keeps non-staff out of the staff app. This is the fence, not the lock: every
 * Convex function re-checks the caller's role on the server.
 */
export function StaffGate({ children }: { children: ReactNode }) {
  const current = useCurrentUser();

  switch (current.status) {
    case "loading":
      return <LoadingScreen />;
    case "error":
      return (
        <StatusScreen note="Hmm, that didn't work" title="Something went wrong">
          <p>{current.message}</p>
        </StatusScreen>
      );
    case "signed-out":
      return (
        <StatusScreen note="Staff only" title="Sign in to Kalami AntiCheat">
          <ButtonLink href="/sign-in">Sign in</ButtonLink>
        </StatusScreen>
      );
    case "ready":
      if (current.me.isStaff) {
        return <>{children}</>;
      }
      return (
        <StatusScreen note="Wrong door" title="This area is for staff">
          <p>
            Kalami AntiCheat is for lecturers and university admins. You&apos;re signed in as{" "}
            <strong className="text-ink">{current.me.email}</strong>.
          </p>
          <p>Invited as a lecturer? Open the invite link while signed in with the invited email.</p>
          <div className="flex flex-wrap gap-3">
            <a href={STUDENT_APP_URL} className={buttonClass("ink")}>
              Open the student app
            </a>
            <SignOutButton>
              <button className={buttonClass("outline")}>Sign out</button>
            </SignOutButton>
          </div>
        </StatusScreen>
      );
  }
}
