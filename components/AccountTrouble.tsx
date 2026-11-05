"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { Button, buttonClass } from "@/components/ui/buttons";
import { LoadingScreen, StatusScreen } from "@/components/ui/StatusScreen";

/** One automatic reload per this long: enough to clear a stale token, never a reload loop. */
const AUTO_RETRY_EVERY_MS = 10 * 60 * 1000;
const RETRY_KEY = "kalami:session-retry";

/** Read only, so it is safe to call while rendering; the retry itself is noted just before reloading. */
function mayRetryNow(): boolean {
  try {
    // The dev galleries show this screen on purpose.
    if (window.location.pathname.startsWith("/dev/")) return false;
    return Date.now() - Number(sessionStorage.getItem(RETRY_KEY) ?? 0) >= AUTO_RETRY_EVERY_MS;
  } catch {
    return false;
  }
}

function reloadNoting() {
  try {
    sessionStorage.setItem(RETRY_KEY, String(Date.now()));
  } catch {
    // Without storage the page still reloads; at worst it retries once more later.
  }
  window.location.reload();
}

/**
 * When signing in half-worked: plain words for the person, a way out (try again,
 * sign out), and for a refused session one quiet automatic retry first. The
 * technical cause goes to the console (CurrentUserProvider), not on screen.
 */
export function AccountTrouble({ kind, message }: { kind: "session" | "account"; message: string }) {
  const [retrying] = useState(() => kind === "session" && typeof window !== "undefined" && mayRetryNow());

  useEffect(() => {
    if (!retrying) return;
    const timer = setTimeout(reloadNoting, 800);
    return () => clearTimeout(timer);
  }, [retrying]);

  if (retrying) {
    return <LoadingScreen label="Reconnecting" />;
  }
  return (
    <StatusScreen
      note="Hmm, that didn't work"
      title={kind === "session" ? "We couldn't confirm your sign-in" : "Your account couldn't be set up"}
    >
      <p>{message}</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => window.location.reload()}>Try again</Button>
        <SignOutButton>
          <button className={buttonClass("outline")}>Sign out</button>
        </SignOutButton>
      </div>
    </StatusScreen>
  );
}
