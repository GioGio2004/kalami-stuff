/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { expectAppError, seed, settle } from "./test.setup";

const keys = { p256dh: "BPUBLICKEY", auth: "AUTHSECRET" };
const device = (n: number) => `https://push.example.com/send/device-${n}`;

describe("push subscriptions", () => {
  test("a student turns a device on and off; staff can't", async () => {
    const { ana, nino, admin } = await seed();
    expect(await ana.query(api.push.vapidPublicKey, {})).toBeNull();
    expect(await ana.query(api.push.mine, {})).toEqual([]);

    await ana.mutation(api.push.subscribe, { endpoint: device(1), keys, userAgent: "Chrome on Android" });
    expect(await ana.query(api.push.mine, {})).toEqual([
      { endpoint: device(1), userAgent: "Chrome on Android", lastUsedAt: expect.any(Number) },
    ]);
    // Subscribing again from the same device refreshes the row instead of adding one.
    await ana.mutation(api.push.subscribe, { endpoint: device(1), keys: { ...keys, auth: "NEW" } });
    expect(await ana.query(api.push.mine, {})).toHaveLength(1);

    await ana.mutation(api.push.unsubscribe, { endpoint: device(1) });
    expect(await ana.query(api.push.mine, {})).toEqual([]);
    // Already gone: fine.
    await ana.mutation(api.push.unsubscribe, { endpoint: device(1) });

    await expectAppError(nino.mutation(api.push.subscribe, { endpoint: device(2), keys }), "FORBIDDEN");
    await expectAppError(admin.query(api.push.mine, {}), "FORBIDDEN");
    await expectAppError(ana.mutation(api.push.subscribe, { endpoint: "not a url", keys }), "INVALID_INPUT");
  });

  test("a device follows whoever signs in on it, and one student keeps at most eight devices", async () => {
    const { ana, giorgi } = await seed();
    await ana.mutation(api.push.subscribe, { endpoint: device(1), keys });
    await giorgi.mutation(api.push.subscribe, { endpoint: device(1), keys });
    expect(await ana.query(api.push.mine, {})).toEqual([]);
    expect((await giorgi.query(api.push.mine, {})).map((d) => d.endpoint)).toEqual([device(1)]);

    for (let n = 10; n < 19; n++) {
      await ana.mutation(api.push.subscribe, { endpoint: device(n), keys });
    }
    const mine = (await ana.query(api.push.mine, {})).map((d) => d.endpoint);
    expect(mine).toHaveLength(8);
    expect(mine).not.toContain(device(10));
    expect(mine).toContain(device(18));
  });

  test("the test button counts devices and only schedules a push when the deployment is set up", async () => {
    const { ana, t } = await seed();
    expect(await ana.mutation(api.push.requestTest, {})).toBe(0);
    await ana.mutation(api.push.subscribe, { endpoint: device(1), keys });
    expect(await ana.mutation(api.push.requestTest, {})).toBe(1);
    // No VAPID settings in tests: nothing was scheduled, so settling runs nothing and sends nothing.
    await settle(t);
    expect(await ana.query(api.push.mine, {})).toHaveLength(1);
  });
});

describe("push delivery bookkeeping", () => {
  test("published work reaches the devices of enrolled students, once", async () => {
    const env = await seed();
    const { ana, giorgi, t } = env;
    await ana.mutation(api.push.subscribe, { endpoint: device(1), keys });
    await ana.mutation(api.push.subscribe, { endpoint: device(2), keys });
    // giorgi has no device; maka isn't enrolled.
    await env.quiz("Quiz 1");

    const rows = await t.run(async (ctx) => ctx.db.query("notifications").take(10));
    expect(rows).toHaveLength(2);
    const ids = rows.map((row) => row._id);
    const payloads = await t.query(internal.push.payloadsFor, { notificationIds: ids });
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ kind: "published", assessmentKind: "quiz", title: "Quiz 1", courseTitle: "Web basics", href: expect.stringMatching(/^\/quizzes\//) });
    expect(payloads[0].subscriptions.map((s) => s.endpoint).sort()).toEqual([device(1), device(2)]);
    expect(await giorgi.query(api.push.mine, {})).toEqual([]);

    // Recorded as pushed: the next batch for the same rows has nothing to send.
    await t.mutation(internal.push.recordResults, { notificationIds: ids, ok: payloads[0].subscriptions.map((s) => s._id), gone: [], failed: [] });
    expect(await t.query(internal.push.payloadsFor, { notificationIds: ids })).toEqual([]);
    const pushed = await t.run(async (ctx) => (await ctx.db.query("notifications").take(10)).map((row) => row.pushedAt !== undefined));
    expect(pushed).toEqual([true, true]);
  });

  test("devices that are gone are removed, repeated failures drop a device, success clears its strikes", async () => {
    const { ana, t } = await seed();
    await ana.mutation(api.push.subscribe, { endpoint: device(1), keys });
    await ana.mutation(api.push.subscribe, { endpoint: device(2), keys });
    await ana.mutation(api.push.subscribe, { endpoint: device(3), keys });
    const rows = await t.run(async (ctx) => ctx.db.query("pushSubscriptions").take(10));
    const idOf = (n: number) => rows.find((row) => row.endpoint === device(n))!._id as Id<"pushSubscriptions">;

    await t.mutation(internal.push.recordResults, { notificationIds: [], ok: [], gone: [idOf(1)], failed: [idOf(2), idOf(3)] });
    expect((await ana.query(api.push.mine, {})).map((d) => d.endpoint).sort()).toEqual([device(2), device(3)]);

    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.push.recordResults, { notificationIds: [], ok: [idOf(3)], gone: [], failed: [idOf(2)] });
    }
    // Device 2 failed four times in a row: still there; the fifth drops it. Device 3 recovered each time.
    expect((await ana.query(api.push.mine, {})).map((d) => d.endpoint).sort()).toEqual([device(2), device(3)]);
    await t.mutation(internal.push.recordResults, { notificationIds: [], ok: [], gone: [], failed: [idOf(2)] });
    expect((await ana.query(api.push.mine, {})).map((d) => d.endpoint)).toEqual([device(3)]);
    const three = await t.run(async (ctx) => ctx.db.get("pushSubscriptions", idOf(3)));
    expect(three?.failures).toBe(0);

    expect(await t.query(internal.push.devicesOf, { userId: rows[0].userId })).toMatchObject({ locale: "ka", subscriptions: [{ endpoint: device(3) }] });
    expect(await t.query(internal.push.userIdByEmail, { email: "ANA@example.com" })).toBe(rows[0].userId);
    expect(await t.query(internal.push.userIdByEmail, { email: "nobody@example.com" })).toBeNull();
  });
});
