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
  | { status: "error"; message: string }
  | { status: "ready"; me: Me };

/** Exported so the dev UI gallery can render screens with sample users. */
export const CurrentUserContext = createContext<CurrentUser>({ status: "loading" });

const BACKEND_REJECTED_SESSION =
  "You're signed in, but the Kalami backend didn't accept the session. Check that CLERK_FRONTEND_API_URL is set on the Convex deployment and that Clerk's Convex integration is enabled.";

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

  let value: CurrentUser;
  if (storeError !== null && storeError.userId === userId) {
    value = { status: "error", message: storeError.message };
  } else if (isLoading) {
    value = { status: "loading" };
  } else if (!isAuthenticated) {
    value = isSignedIn
      ? { status: "error", message: BACKEND_REJECTED_SESSION }
      : { status: "signed-out" };
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
