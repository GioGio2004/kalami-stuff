/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ISSUER = "https://test.clerk.accounts.dev";
const SECRET = "test-service-secret-0123456789abcdef";

function person(name: string): Partial<UserIdentity> {
  return {
    issuer: ISSUER,
    subject: `user_${name}`,
    tokenIdentifier: `${ISSUER}|user_${name}`,
    email: `${name}@example.com`,
    emailVerified: true,
    givenName: name,
  } as Partial<UserIdentity>;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** What lib/mcp/oauth.ts serviceCredential() produces in the staff app. */
async function credential(clerkUserId: string, { expiresIn = 60_000, secret = SECRET } = {}) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: clerkUserId, e: Date.now() + expiresIn })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `svc.${payload}.${b64url(signature)}`;
}

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity(person("admin"));
  await admin.mutation(api.users.store, {});
  await t.mutation(internal.admin.grantSuperAdmin, { email: "admin@example.com" });
  const gori = await admin.mutation(api.universities.create, { nameKa: "გორი", nameEn: "Gori State", slug: "gori" });
  const nino = t.withIdentity(person("nino"));
  const ninoId = await nino.mutation(api.users.store, {});
  await t.run(async (ctx) => {
    await ctx.db.insert("memberships", { userId: ninoId, role: "lecturer", universityId: gori });
  });
  const ana = t.withIdentity(person("ana"));
  await ana.mutation(api.users.store, {});
  await ana.mutation(api.users.completeStudentOnboarding, {
    firstName: "ანა",
    lastName: "ბ",
    universityId: gori,
    faculty: "CS",
    group: "1",
    year: 1,
    locale: "ka",
    honestyVersion: HONESTY_NOTICE.version,
  });
  return { t };
}

describe("Sign in with Kalami (OAuth) on the MCP connector", () => {
  beforeEach(() => vi.stubEnv("MCP_SERVICE_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  test("a signed credential for a lecturer acts as that lecturer, through the MCP path", async () => {
    const { t } = await setup();
    const token = await credential("user_nino");
    expect(await t.query(api.mcp.whoami, { token })).toMatchObject({ email: "nino@example.com", isSuperAdmin: false });
    const courseId = await t.mutation(api.mcp.createCourseAsAgent, { token, title: "Web basics" });
    const audit = await t.run(async (ctx) =>
      ctx.db.query("auditLog").withIndex("by_courseId", (q) => q.eq("courseId", courseId)).take(5),
    );
    expect(audit[0]).toMatchObject({ via: "mcp", action: "course.create" });
  });

  test("students, forged, expired and unknown credentials get nothing", async () => {
    const { t } = await setup();
    expect(await t.query(api.mcp.whoami, { token: await credential("user_ana") })).toBeNull();
    expect(await t.query(api.mcp.whoami, { token: await credential("user_nino", { secret: "wrong" }) })).toBeNull();
    expect(await t.query(api.mcp.whoami, { token: await credential("user_nino", { expiresIn: -1 }) })).toBeNull();
    expect(await t.query(api.mcp.whoami, { token: await credential("user_nobody") })).toBeNull();
    const good = await credential("user_nino");
    const [prefix, , signature] = good.split(".");
    const otherPayload = (await credential("user_admin")).split(".")[1];
    expect(await t.query(api.mcp.whoami, { token: `${prefix}.${otherPayload}.${signature}` })).toBeNull();
  });

  test("without the secret configured, no credential works", async () => {
    const { t } = await setup();
    const token = await credential("user_nino");
    vi.stubEnv("MCP_SERVICE_SECRET", "");
    expect(await t.query(api.mcp.whoami, { token })).toBeNull();
  });
});
