"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";

export type Me = NonNullable<FunctionReturnType<typeof api.users.me>>;

export type CurrentUser =
  | { status: "loading" }
  | { status: "signed-out" }
  /** `session`: Clerk says signed in but the backend refused the token; `account`: setting up the account failed. */
  | { status: "error"; kind: "session" | "account"; message: string }
  | { status: "ready"; me: Me };

/** Exported so the dev UI gallery can render screens with sample users. */
export const CurrentUserContext = createContext<CurrentUser>({ status: "loading" });

const SESSION_REJECTED =
  "This usually sorts itself out. Try again, or sign out and sign back in.";

/** For whoever runs Kalami, never for students: what to check when this keeps happening. */
const SESSION_REJECTED_DETAIL =
  "[Kalami] Clerk reports a session but Convex rejected its token. Check that CLERK_FRONTEND_API_URL on this Convex " +
  "deployment matches the Clerk instance of NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, that the session token has aud: \"convex\", " +
  "and that the computer's clock is right.";

/** A refused token can be a moment's hiccup (a refresh after sleep); only a lasting refusal is an error. */
const REJECTION_GRACE_MS = 4000;

/**
 * Stores the signed-in user in Convex once per session and exposes `users.me`.
 * Pages read the current user from here instead of calling Clerk directly.
 */
export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, userId } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const storeUser = useMutation(api.users.store);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  // Keyed by Clerk user so an error from a previous account doesn't linger.
  const [storeError, setStoreError] = useState<{ userId: string; message: string } | null>(null);
  const rejected = isSignedIn === true && !isLoading && !isAuthenticated;
  const [rejectedFor, setRejectedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      return;
    }
    let cancelled = false;
    storeUser().catch((error: unknown) => {
      if (!cancelled) {
        setStoreError({ userId, message: errorMessage(error) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId, storeUser]);

  useEffect(() => {
    if (!rejected || !userId) return;
    const timer = setTimeout(() => {
      console.warn(SESSION_REJECTED_DETAIL);
      setRejectedFor(userId);
    }, REJECTION_GRACE_MS);
    return () => clearTimeout(timer);
  }, [rejected, userId]);

  let value: CurrentUser;
  if (storeError !== null && storeError.userId === userId) {
    value = { status: "error", kind: "account", message: storeError.message };
  } else if (isLoading) {
    value = { status: "loading" };
  } else if (!isAuthenticated) {
    value = !isSignedIn
      ? { status: "signed-out" }
      : rejectedFor === userId
        ? { status: "error", kind: "session", message: SESSION_REJECTED }
        : { status: "loading" };
  } else if (!me) {
    // undefined while loading; null until `store` has created the row.
    value = { status: "loading" };
  } else {
    value = { status: "ready", me };
  }

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUser {
  return useContext(CurrentUserContext);
}
