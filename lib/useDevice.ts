"use client";

import { useSyncExternalStore } from "react";

/**
 * Phones and tablets: a narrow screen, or a touch screen with no mouse. Code
 * tasks need a keyboard and room for the editor and the preview, so they stay
 * on computers for now.
 */
const MOBILE_QUERY = "(max-width: 767px), (hover: none) and (pointer: coarse)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** False while rendering on the server; the real answer arrives right after hydration. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

const noChange = () => () => undefined;

/** iPhones can't put a web page in fullscreen, which strict exams require. */
export function useCanFullscreen(): boolean {
  return useSyncExternalStore(
    noChange,
    () => document.fullscreenEnabled === true,
    () => true,
  );
}
