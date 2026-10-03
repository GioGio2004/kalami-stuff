/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://test.clerk.accounts.dev";
// svix secrets are "whsec_" + base64 key bytes.
const SECRET = `whsec_${btoa("kalami-webhook-test-secret-32byt")}`;

beforeEach(() => {
  vi.stubEnv("CLERK_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("CLERK_FRONTEND_API_URL", ISSUER);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

let messageCount = 0;

/** A Clerk event, signed the way Clerk's svix endpoint signs it. */
function signedRequest(event: object, secret = SECRET): RequestInit {
  const body = JSON.stringify(event);
  const id = `msg_${++messageCount}`;
  const timestamp = new Date();
  return {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": new Webhook(secret).sign(id, timestamp, body),
    },
  };
}

function userEvent(
  type: "user.created" | "user.updated",
  { id, email, firstName = "Ana", lastName = "Beridze" }: { id: string; email: string; firstName?: string; lastName?: string },
) {
  return {
    type,
    object: "event",
    data: {
      id,
      object: "user",
      first_name: firstName,
      last_name: lastName,
      image_url: `https://img.clerk.com/${id}.png`,
      primary_email_address_id: "idn_primary",
      email_addresses: [
        { id: "idn_other", email_address: "old@example.com" },
        { id: "idn_primary", email_address: email },
      ],
    },
  };
}

function signedIn(t: ReturnType<typeof convexTest>, clerkUserId: string, email: string) {
  return t.withIdentity({
    issuer: ISSUER,
    subject: clerkUserId,
    tokenIdentifier: `${ISSUER}|${clerkUserId}`,
    email,
    emailVerified: true,
  });
}

const allUsers = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("users").collect());

describe("Clerk webhook", () => {
  test("user.created makes the row that signing in later uses", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(
      "/clerk-users-webhook",
      signedRequest(userEvent("user.created", { id: "user_ana", email: "Ana@Example.com" })),
    );
    expect(response.status).toBe(200);

    const [row] = await allUsers(t);
    expect(row).toMatchObject({
      tokenIdentifier: `${ISSUER}|user_ana`,
      clerkUserId: "user_ana",
      email: "ana@example.com",
      firstName: "Ana",
      avatarUrl: "https://img.clerk.com/user_ana.png",
    });

    const ana = signedIn(t, "user_ana", "ana@example.com");
    expect(await ana.mutation(api.users.store, {})).toBe(row._id);
    expect(await allUsers(t)).toHaveLength(1);
  });

  test("user.updated follows email and avatar but keeps onboarding names", async () => {
    const t = convexTest(schema, modules);
    const ana = signedIn(t, "user_ana", "ana@example.com");
    await ana.mutation(api.users.store, {});
    await t.run(async (ctx) => {
      const user = (await ctx.db.query("users").first())!;
      await ctx.db.patch("users", user._id, { firstName: "ანა", lastName: "ბერიძე" });
    });

    await t.fetch(
      "/clerk-users-webhook",
      signedRequest(userEvent("user.updated", { id: "user_ana", email: "ana.new@example.com" })),
    );
    expect(await allUsers(t)).toMatchObject([
      { email: "ana.new@example.com", firstName: "ანა", lastName: "ბერიძე" },
    ]);
  });

  test("rows created before webhooks existed are matched and backfilled", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: `${ISSUER}|user_old`,
        email: "old@example.com",
        locale: "ka",
      }),
    );
    await t.fetch(
      "/clerk-users-webhook",
      signedRequest(userEvent("user.updated", { id: "user_old", email: "old@example.com" })),
    );
    expect(await allUsers(t)).toMatchObject([{ clerkUserId: "user_old" }]);
  });

  test("signing in adopts a webhook row even if its tokenIdentifier differs", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("CLERK_FRONTEND_API_URL", "https://stale-issuer.example");
    await t.fetch(
      "/clerk-users-webhook",
      signedRequest(userEvent("user.created", { id: "user_ana", email: "ana@example.com" })),
    );
    vi.stubEnv("CLERK_FRONTEND_API_URL", ISSUER);

    await signedIn(t, "user_ana", "ana@example.com").mutation(api.users.store, {});
    expect(await allUsers(t)).toMatchObject([{ tokenIdentifier: `${ISSUER}|user_ana` }]);
  });

  test("user.deleted removes the person and their roles, and can repeat", async () => {
    const t = convexTest(schema, modules);
    const ana = signedIn(t, "user_ana", "ana@example.com");
    const universityId: Id<"universities"> = await t.run((ctx) =>
      ctx.db.insert("universities", { name: { ka: "ა", en: "A" }, slug: "a", status: "active" }),
    );
    await ana.mutation(api.users.completeStudentOnboarding, {
      firstName: "ანა",
      lastName: "ბერიძე",
      universityId,
      faculty: "CS",
      group: "1",
      year: 1,
      locale: "ka",
      honestyVersion: HONESTY_NOTICE.version,
    });

    const deletion = { type: "user.deleted", object: "event", data: { id: "user_ana", deleted: true } };
    expect((await t.fetch("/clerk-users-webhook", signedRequest(deletion))).status).toBe(200);
    expect((await t.fetch("/clerk-users-webhook", signedRequest(deletion))).status).toBe(200);
    expect(await allUsers(t)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("memberships").collect())).toHaveLength(0);
  });

  test("unsigned, tampered or replayed requests are rejected", async () => {
    const t = convexTest(schema, modules);
    const event = userEvent("user.created", { id: "user_eve", email: "eve@example.com" });

    const wrongKey = `whsec_${btoa("not-the-real-secret-not-the-real")}`;
    expect((await t.fetch("/clerk-users-webhook", signedRequest(event, wrongKey))).status).toBe(400);

    const tampered = signedRequest(event);
    tampered.body = JSON.stringify({ ...event, data: { ...event.data, id: "user_admin" } });
    expect((await t.fetch("/clerk-users-webhook", tampered)).status).toBe(400);

    expect(
      (await t.fetch("/clerk-users-webhook", { method: "POST", body: JSON.stringify(event) })).status,
    ).toBe(400);

    const stale = signedRequest(event);
    const old = new Date(Date.now() - 10 * 60 * 1000);
    const headers = stale.headers as Record<string, string>;
    headers["svix-timestamp"] = String(Math.floor(old.getTime() / 1000));
    headers["svix-signature"] = new Webhook(SECRET).sign(headers["svix-id"], old, stale.body as string);
    expect((await t.fetch("/clerk-users-webhook", stale)).status).toBe(400);

    expect(await allUsers(t)).toHaveLength(0);
  });

  test("without a linked primary email only a verified address is used", async () => {
    const t = convexTest(schema, modules);
    const event = (id: string, status: string) => ({
      type: "user.created",
      object: "event",
      data: {
        id,
        primary_email_address_id: null,
        email_addresses: [{ id: "idn_1", email_address: `${id}@example.com`, verification: { status } }],
      },
    });
    expect((await t.fetch("/clerk-users-webhook", signedRequest(event("user_ok", "verified")))).status).toBe(200);
    expect((await t.fetch("/clerk-users-webhook", signedRequest(event("user_no", "unverified")))).status).toBe(200);
    expect(await allUsers(t)).toMatchObject([{ clerkUserId: "user_ok", email: "user_ok@example.com" }]);
  });

  test("a missing secret fails closed", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("CLERK_WEBHOOK_SECRET", "");
    const response = await t.fetch(
      "/clerk-users-webhook",
      signedRequest(userEvent("user.created", { id: "user_ana", email: "ana@example.com" })),
    );
    expect(response.status).toBe(500);
    expect(await allUsers(t)).toHaveLength(0);
  });
});
