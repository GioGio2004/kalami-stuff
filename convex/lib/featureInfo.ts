import type { Feature } from "./validators";

/**
 * What each per-person feature is (lib/features.ts decides who has one). No
 * server imports here, so the admin panel shows the same names and words.
 */
export const FEATURE_INFO: Record<Feature, { label: string; description: string }> = {
  crosswords: {
    label: "Crosswords",
    description: "Make practice crosswords in weeks, by hand or with their AI assistant.",
  },
};

export const FEATURES = Object.keys(FEATURE_INFO) as Feature[];
