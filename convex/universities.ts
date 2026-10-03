import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getMemberships, requireIdentity, requireSuperAdmin, requireUser } from "./lib/auth";
import { appError } from "./lib/errors";
import { requireText } from "./lib/input";
import { localizedTextValidator, universityStatusValidator } from "./lib/validators";

const universityValidator = v.object({
  _id: v.id("universities"),
  name: localizedTextValidator,
  slug: v.string(),
  status: universityStatusValidator,
});

function toUniversity({ _id, name, slug, status }: Doc<"universities">) {
  return { _id, name, slug, status };
}

/** Universities a student can pick during onboarding. */
export const listActive = query({
  args: {},
  returns: v.array(universityValidator),
  handler: async (ctx) => {
    await requireIdentity(ctx);
    const universities = await ctx.db
      .query("universities")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(200);
    return universities.map(toUniversity);
  },
});

/** Every university for the super admin; a uni_admin's own universities otherwise. */
export const listAdministered = query({
  args: {},
  returns: v.array(universityValidator),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const memberships = await getMemberships(ctx, user._id);
    if (memberships.some((m) => m.role === "super_admin")) {
      const universities = await ctx.db.query("universities").order("desc").take(200);
      return universities.map(toUniversity);
    }

    const universityIds = memberships.flatMap((m) =>
      m.role === "uni_admin" && m.universityId ? [m.universityId] : [],
    );
    if (universityIds.length === 0) {
      throw appError("FORBIDDEN", "Only university admins can see this.");
    }
    const universities = await Promise.all(
      universityIds.map((id) => ctx.db.get("universities", id)),
    );
    return universities.flatMap((u) => (u ? [toUniversity(u)] : []));
  },
});

export const create = mutation({
  args: { nameKa: v.string(), nameEn: v.string(), slug: v.string() },
  returns: v.id("universities"),
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const slug = args.slug.trim().toLowerCase();
    if (slug.length > 40 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw appError("INVALID_INPUT", "Slug: lowercase letters, digits and single dashes, e.g. gori-state.");
    }
    const taken = await ctx.db
      .query("universities")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (taken !== null) {
      throw appError("CONFLICT", `The slug "${slug}" is already used.`);
    }
    return await ctx.db.insert("universities", {
      name: {
        ka: requireText(args.nameKa, "Georgian name", 120),
        en: requireText(args.nameEn, "English name", 120),
      },
      slug,
      status: "active",
    });
  },
});
