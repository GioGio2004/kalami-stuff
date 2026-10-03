import { v } from "convex/values";
import { query } from "./_generated/server";
import { HONESTY_NOTICE } from "./lib/honestyNotice";

const noticeTextValidator = v.object({
  title: v.string(),
  intro: v.string(),
  sections: v.array(v.object({ heading: v.string(), items: v.array(v.string()) })),
});

/** Deliberately public: anyone may read what Kalami tracks, signed in or not. */
export const current = query({
  args: {},
  returns: v.object({
    version: v.number(),
    ka: noticeTextValidator,
    en: noticeTextValidator,
  }),
  handler: async () => HONESTY_NOTICE,
});
