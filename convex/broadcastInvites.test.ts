/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { renderAnnouncementEmail } from "./lib/email/templates";
import { HONESTY_NOTICE } from "./lib/honestyNotice";
import { unsubscribeToken } from "./lib/tokens";
import { expectAppError, person, seed, settle } from "./test.setup";

// The notification center with pasted email addresses (model/broadcasts.ts):
// accounts and strangers alike, and a message that doubles as a group invitation.

type Env = Awaited<ReturnType<typeof seed>>;
const PAGE = { numItems: 50, cursor: null };

beforeEach(() => {
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.convex.site");
  vi.stubEnv("STUDENT_APP_URL", "https://app.kalami.space");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
});
afterEach(() => vi.unstubAllEnvs());

const message = {
  title: "Welcome to ICT-24-1",
  body: "Your group for the year.\n\nSee you on Monday.",
  channels: { push: false, email: false },
  emailEveryone: false,
};

async function dean(env: Env) {
  const identity = env.t.withIdentity(person("dean"));
  const userId = await identity.mutation(api.users.store, {});
  await env.t.run(async (ctx) => {
    await ctx.db.insert("memberships", { userId, role: "uni_admin", universityId: env.universityId });
  });
  return identity;
}

/** A student at a second university, out of the dean's reach. */
async function elsewhere(env: Env) {
  const tsu = await env.admin.mutation(api.universities.create, { nameKa: "თსუ", nameEn: "Tbilisi State", slug: "tsu" });
  const anka = env.t.withIdentity(person("anka"));
  await anka.mutation(api.users.store, {});
  await anka.mutation(api.users.completeStudentOnboarding, {
    firstName: "Anka",
    lastName: "T",
    universityId: tsu,
    faculty: "Law",
    group: "L-1",
    year: 2,
    locale: "en",
    honestyVersion: HONESTY_NOTICE.version,
  });
  return { tsu, anka };
}

async function deliveries(env: Env, broadcastId: Id<"broadcasts">) {
  const page = await env.admin.query(api.platform.broadcastRecipients, { broadcastId, paginationOpts: PAGE });
  return new Map(page.page.map((row) => [row.email, row]));
}

async function invitesOf(env: Env, groupId: Id<"groups">) {
  return await env.t.run(async (ctx) =>
    ctx.db
      .query("groupInvites")
      .withIndex("by_groupId", (q) => q.eq("groupId", groupId))
      .take(20),
  );
}

describe("notification center: email addresses", () => {
  test("accounts get everything, strangers the email; a university admin's paste reaches other universities by email only", async () => {
    const env = await seed();
    const { t, admin, ana } = env;
    const { anka } = await elsewhere(env);
    const d = await dean(env);
    const audience = {
      kind: "emails" as const,
      emails: ["Ana@Example.com, new.student@example.com", "nino@example.com\nanka@example.com", "ana@example.com"],
    };
    expect(await d.query(api.platform.broadcastPreview, { audience, emailEveryone: false })).toMatchObject({
      recipients: 4,
      students: 1,
      staff: 1,
      noAccount: 2,
      emailable: 4,
      blocked: 0,
    });
    const broadcastId = await d.mutation(api.platform.sendBroadcast, { ...message, channels: { push: true, email: true }, audience });
    await settle(t);
    const [row] = await d.query(api.platform.broadcasts, {});
    expect(row).toMatchObject({ audienceLabel: "4 email addresses", recipients: 4, inApp: 1, emailed: 4, status: "sent" });
    expect(row.groupName).toBeUndefined();

    const got = await deliveries(env, broadcastId);
    expect(got.get("ana@example.com")).toMatchObject({ name: "ana S", role: "student", inApp: true, emailed: true, invited: false });
    expect(got.get("nino@example.com")).toMatchObject({ role: "lecturer", inApp: false, emailed: true });
    expect(got.get("new.student@example.com")).toMatchObject({ name: "", role: "none", inApp: false, emailed: true, invited: false });
    // anka has an account, but at another university: the dean only reaches her address.
    expect(got.get("anka@example.com")).toMatchObject({ name: "", role: "none", inApp: false, emailed: true });
    expect((await anka.query(api.notifications.inbox, {})).items).toHaveLength(0);
    expect((await ana.query(api.notifications.inbox, {})).items).toHaveLength(1);

    // The platform admin reaches anka's account through the same address.
    const byAdmin = await admin.mutation(api.platform.sendBroadcast, {
      ...message,
      audience: { kind: "emails", emails: ["anka@example.com"] },
    });
    await settle(t);
    expect((await deliveries(env, byAdmin)).get("anka@example.com")).toMatchObject({ name: "Anka T", role: "student", inApp: true });
    expect((await anka.query(api.notifications.inbox, {})).items[0]).toMatchObject({ kind: "announcement", courseTitle: "Kalami" });
  });

  test("bad addresses are refused by name; an empty paste too", async () => {
    const env = await seed();
    await expect(
      env.admin.mutation(api.platform.sendBroadcast, {
        ...message,
        audience: { kind: "emails", emails: ["ana@example.com", "not an address", "x@"] },
      }),
    ).rejects.toThrow(/not, an, address, x@/);
    await expectAppError(
      env.admin.query(api.platform.broadcastPreview, { audience: { kind: "emails", emails: [" , "] }, emailEveryone: false }),
      "INVALID_INPUT",
    );
  });
});

describe("notification center: a message as an invitation", () => {
  test("everyone not yet in the group gets a personal invite the email and the bell carry; sending again reuses it", async () => {
    const env = await seed();
    const { t, admin, nino, ana, maka } = env;
    const groupId = await admin.mutation(api.groups.create, { name: "ICT-24-1", universityId: env.universityId });
    await nino.mutation(api.groups.joinAsLecturer, { groupId });
    const { inviteCode } = await nino.query(api.groups.get, { groupId });
    await maka.mutation(api.groups.join, { code: inviteCode });
    await ana.mutation(api.notifications.setEmailPreference, { enabled: false });
    const audience = { kind: "emails" as const, emails: ["ana@example.com", "maka@example.com", "new.student@example.com"] };

    const broadcastId = await admin.mutation(api.platform.sendBroadcast, { ...message, audience, groupId });
    await settle(t);
    const [row] = await admin.query(api.platform.broadcasts, {});
    expect(row).toMatchObject({
      audienceLabel: "3 email addresses, invited to ICT-24-1",
      groupId,
      groupName: "ICT-24-1",
      // Chosen without email: an invitation goes by email all the same.
      channels: { push: false, email: true },
      recipients: 3,
      inApp: 2,
      emailed: 3,
      status: "sent",
    });
    const got = await deliveries(env, broadcastId);
    // ana switched notification emails off; an invitation still comes, as from the group's page.
    expect(got.get("ana@example.com")).toMatchObject({ invited: true, emailed: true, inApp: true });
    // maka is in the group already: the plain message.
    expect(got.get("maka@example.com")).toMatchObject({ invited: false, emailed: true, inApp: true });
    expect(got.get("new.student@example.com")).toMatchObject({ invited: true, emailed: true, role: "none" });

    const invites = await invitesOf(env, groupId);
    expect(invites.map((invite) => invite.email).sort()).toEqual(["ana@example.com", "new.student@example.com"]);
    // The message carried the link; the invite itself was not emailed separately.
    expect(invites.every((invite) => invite.emailedAt === undefined)).toBe(true);
    const anaInvite = invites.find((invite) => invite.email === "ana@example.com")!;
    expect((await ana.query(api.notifications.inbox, {})).items[0].href).toBe(`/join/invite/${anaInvite.token}`);
    expect((await maka.query(api.notifications.inbox, {})).items[0].href).toBe("/dashboard");
    expect((await nino.query(api.groups.get, { groupId })).pendingInvites).toBe(2);

    // Again: the open invites are reused, nobody gets a second one.
    await admin.mutation(api.platform.sendBroadcast, { ...message, audience, groupId });
    await settle(t);
    expect(await invitesOf(env, groupId)).toHaveLength(2);
    expect((await nino.query(api.groups.get, { groupId })).pendingInvites).toBe(2);
  });

  test("only with addresses or picked people, and only an open group within reach", async () => {
    const env = await seed();
    const { admin, universityId } = env;
    const { tsu } = await elsewhere(env);
    const groupId = await admin.mutation(api.groups.create, { name: "ICT-24-1", universityId });
    const foreign = await admin.mutation(api.groups.create, { name: "TSU-1", universityId: tsu });
    const d = await dean(env);
    const emails = { kind: "emails" as const, emails: ["new.student@example.com"] };
    await expectAppError(
      admin.mutation(api.platform.sendBroadcast, { ...message, audience: { kind: "students", universityId }, groupId }),
      "INVALID_INPUT",
    );
    await expectAppError(d.mutation(api.platform.sendBroadcast, { ...message, audience: emails, groupId: foreign }), "NOT_FOUND");
    await admin.mutation(api.groups.update, { groupId, archived: true });
    await expectAppError(d.mutation(api.platform.sendBroadcast, { ...message, audience: emails, groupId }), "CONFLICT");
  });

  test("the unsubscribe link in an address-only email lists the address; later messages skip it", async () => {
    const env = await seed();
    const { t, admin } = env;
    const email = "new.student@example.com";
    const send = () =>
      admin.mutation(api.platform.sendBroadcast, { ...message, channels: { push: false, email: true }, audience: { kind: "emails", emails: [email] } });
    const first = await send();
    await settle(t);
    expect((await deliveries(env, first)).get(email)).toMatchObject({ emailed: true });

    const token = (await unsubscribeToken(email))!;
    const link = `/email/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
    expect((await t.fetch(`${link.slice(0, -2)}xx`, { method: "POST" })).status).toBe(404);
    expect((await t.fetch(link, { method: "GET" })).status).toBe(200);
    expect((await t.fetch(link, { method: "POST" })).status).toBe(200);
    expect((await admin.query(api.platform.system, { now: Date.now() })).email.suppressions).toMatchObject([{ email, status: "unsubscribed" }]);

    const second = await send();
    await settle(t);
    expect((await deliveries(env, second)).get(email)).toMatchObject({ emailed: false, emailSkipped: "blocked" });
    expect(
      await admin.query(api.platform.broadcastPreview, { audience: { kind: "emails", emails: [email] }, emailEveryone: true }),
    ).toMatchObject({ noAccount: 1, blocked: 1, emailable: 0 });
  });
});

describe("the invitation email", () => {
  test("names the group, accepts with the button, and explains itself in both languages to an unknown address", () => {
    const email = renderAnnouncementEmail({
      from: "Gori State University",
      title: "Welcome",
      body: "Hello there.",
      invite: { groupName: "ICT-24-1", url: "https://app.kalami.space/join/invite/abc" },
      unsubscribeUrl: "https://backend.convex.site/email/unsubscribe?e=x%40y.z&t=2",
    });
    expect(email.text).toContain("გამარჯობა!");
    expect(email.text).toContain("ჯგუფი: ICT-24-1");
    expect(email.text).toContain("მოწვევის მიღება: https://app.kalami.space/join/invite/abc");
    expect(email.text).toContain("მოწვევის მისაღებად შედი ან დარეგისტრირდი სწორედ ამ ელფოსტით.");
    expect(email.text).toContain("You get this because Gori State University sent it to your address through Kalami.");
    expect(email.text).toContain("შეტყობინებების გამორთვა: https://backend.convex.site/email/unsubscribe?e=x%40y.z&t=2");
  });
});
