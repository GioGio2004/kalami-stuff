"use client";

import { useSyncExternalStore } from "react";

const PRODUCTION_ORIGIN = "https://staff.kalami.space";

// The origin never changes while the page is open, so there is nothing to subscribe to.
const subscribe = () => () => {};

/** The staff app's own origin, for URLs people paste elsewhere. Production during SSR. */
export function useOrigin(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => PRODUCTION_ORIGIN,
  );
}
