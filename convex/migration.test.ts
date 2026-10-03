/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const OLD = "https://old-app.clerk.accounts.dev";
const NEW = "https://new-app.clerk.accounts.dev";

function identity(issuer: string, subject: string, emailVerified = true): Partial<UserIdentity> {
  return {
    issuer,
    subject,
    tokenIdentifier: `${issuer}|${subject}`,
    email: "gio@example.com",
    emailVerified,
    givenName: "Gio",
  } as Partial<UserIdentity>;
}

test("moving to a new Clerk app: the same verified email keeps the account and its roles", async () => {
  const t = convexTest(schema, modules);
  const before = await t.withIdentity(identity(OLD, "user_old")).mutation(api.users.store, {});
  await t.mutation(internal.admin.grantSuperAdmin, { email: "gio@example.com" });

  // An unverified email never takes an account over.
  const stranger = await t.withIdentity(identity(NEW, "user_x", false)).mutation(api.users.store, {});
  expect(stranger).not.toBe(before);
  await t.run(async (ctx) => ctx.db.delete("users", stranger));

  const after = await t.withIdentity(identity(NEW, "user_new")).mutation(api.users.store, {});
  expect(after).toBe(before);
  const row = await t.run(async (ctx) => ctx.db.get("users", after));
  expect(row).toMatchObject({ tokenIdentifier: `${NEW}|user_new`, clerkUserId: "user_new" });
  const me = await t.withIdentity(identity(NEW, "user_new")).query(api.users.me, {});
  expect(me?.isSuperAdmin).toBe(true);
});

test("the Clerk webhook hands the old row over too", async () => {
  vi.stubEnv("CLERK_FRONTEND_API_URL", NEW);
  const t = convexTest(schema, modules);
  const before = await t.withIdentity(identity(OLD, "user_old")).mutation(api.users.store, {});
  await t.mutation(internal.users.upsertFromClerk, { clerkUserId: "user_new", email: "Gio@example.com" });
  const rows = await t.run(async (ctx) => ctx.db.query("users").take(10));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ _id: before, tokenIdentifier: `${NEW}|user_new`, clerkUserId: "user_new" });
  vi.unstubAllEnvs();
});
