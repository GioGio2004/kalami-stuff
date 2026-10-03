// The checks engine lives with the backend (convex/lib/checks), which grades with it.
// The student app keeps a copy at this same path, so shared components import "@/lib/checks".
export * from "@/convex/lib/checks";
