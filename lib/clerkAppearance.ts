import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

type Appearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

/**
 * Clerk's sign-in, sign-up and user menu in the Kalami look. Values mirror the
 * tokens in app/globals.css (Clerk derives shades from them, so they stay literal).
 * Clerk's styles live in the "clerk" CSS layer, which Tailwind utilities override.
 */
export const clerkAppearance: Appearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "#141414",
    colorPrimaryForeground: "#fafaf7",
    colorDanger: "#ee4a2e",
    colorSuccess: "#2c9e62",
    colorWarning: "#dd9a00",
    colorForeground: "#141414",
    colorMutedForeground: "#64635e",
    colorMuted: "#eeede8",
    colorBackground: "#ffffff",
    colorInput: "#ffffff",
    colorInputForeground: "#141414",
    colorBorder: "#deddd6",
    colorRing: "#b5d22b",
    colorNeutral: "#141414",
    fontFamily: "var(--font-geist-sans), var(--font-georgian), ui-sans-serif, system-ui, sans-serif",
    fontSize: "0.9375rem",
    borderRadius: "0.9rem",
  },
  elements: {
    cardBox: "rounded-[2rem] border border-line shadow-[0_30px_70px_-40px_rgba(20,20,20,0.45)]",
    headerTitle: "text-2xl font-medium tracking-[-0.03em]",
    formButtonPrimary: "rounded-full py-2.5 text-[15px] shadow-none",
    socialButtonsBlockButton: "rounded-full border border-ink/15 shadow-none hover:bg-panel",
    formFieldInput:
      "rounded-xl border border-ink/15 py-2.5 shadow-none focus:border-ink focus:ring-4 focus:ring-highlighter/60",
    footer: "bg-panel/60",
    userButtonAvatarBox: "size-10",
  },
};
