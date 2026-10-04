/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DRIVE_SCOPE } from "./lib/google";
import { expectAppError, seed, settle } from "./test.setup";

/**
 * A pretend Clerk + Google Drive: folders and "anyone" permissions in memory,
 * and a log of every call, so the tests can check what Kalami asked Google for.
 */
function fakeGoogle(options: { scopes?: string[]; busyShares?: number } = {}) {
  const folders = new Map<string, { name: string; parent?: string; tag: string; permissions: Set<string> }>();
  const calls: string[] = [];
  let busy = options.busyShares ?? 0;
  let next = 1;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (url.host === "api.clerk.com") {
      return json([{ token: "google-token", scopes: options.scopes ?? ["openid", DRIVE_SCOPE] }]);
    }
    if (new Headers(init?.headers).get("Authorization") !== "Bearer google-token") {
      return json({ error: { message: "no" } }, 401);
    }
    const parts = url.pathname.replace("/drive/v3/files", "").split("/").filter(Boolean);
    if (parts.length === 0 && method === "GET") {
      const tag = /value='([^']+)'/.exec(url.searchParams.get("q") ?? "")?.[1];
      const found = [...folders.entries()].filter(([, f]) => f.tag === tag).map(([id]) => ({ id }));
      return json({ files: found });
    }
    if (parts.length === 0 && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { name: string; parents?: string[]; appProperties: { kalami: string } };
      const id = `folder${next++}`;
      folders.set(id, { name: body.name, parent: body.parents?.[0], tag: body.appProperties.kalami, permissions: new Set() });
      return json({ id });
    }
    const folder = folders.get(parts[0]);
    if (folder === undefined) {
      return json({ error: { message: "File not found" } }, 404);
    }
    if (parts.length === 1) {
      return json({ id: parts[0], trashed: false });
    }
    if (parts[1] === "permissions" && method === "POST") {
      if (busy > 0) {
        busy--;
        return json({ error: { errors: [{ reason: "sharingRateLimitExceeded" }], message: "Rate limit" } }, 403);
      }
      const id = `perm${next++}`;
      folder.permissions.add(id);
      return json({ id });
    }
    if (parts[1] === "permissions" && method === "DELETE") {
      folder.permissions.delete(parts[2]);
      return new Response(null, { status: 204 });
    }
    return json({ error: { message: "unexpected" } }, 400);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { folders, calls };
}

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_x");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function outline(nino: Awaited<ReturnType<typeof seed>>["nino"], courseId: Id<"courses">) {
  return await nino.query(api.weeks.outline, { courseId, now: Date.now() });
}

describe("course outline", () => {
  test("weeks hold lessons, links and placed work; students see only what's published", async () => {
    const { nino, ana, maka, courseId, quiz } = await seed();
    const week1 = await nino.mutation(api.weeks.create, { courseId, links: [{ title: "MDN", url: "https://developer.mozilla.org" }] });
    const week2 = await nino.mutation(api.weeks.create, { courseId, title: "Unit 2 · Forms" });
    const lessonId = await nino.mutation(api.lessons.create, {
      weekId: week1,
      title: "What is HTML",
      blocks: [{ type: "text", md: "HTML describes **structure**." }],
    });
    const { assessmentId } = await quiz("Week 1 quiz");
    await nino.mutation(api.weeks.place, { assessmentId, weekId: week1 });
    const midterm = await nino.mutation(api.assessments.create, { courseId, kind: "midterm", title: "Midterm" });

    const staff = await outline(nino, courseId);
    expect(staff.weeks.map((w) => [w.title, w.status, w.lessons.length, w.assessments.length, w.links.length])).toEqual([
      ["კვირა 1", "draft", 1, 1, 1],
      ["Unit 2 · Forms", "draft", 0, 0, 0],
    ]);
    expect(staff.exams.map((a) => a._id)).toEqual([midterm]);

    // A Georgian course names new weeks in Georgian.
    // Nothing of a draft week reaches students: not the week, not its lesson.
    let course = await ana.query(api.learn.course, { courseId });
    expect(course.weeks).toEqual([]);
    await expectAppError(ana.query(api.lessons.read, { lessonId }), "NOT_FOUND");
    // The published quiz still shows, just not inside the hidden week.
    expect(course.assessments.find((a) => a._id === assessmentId)?.weekId).toBeUndefined();

    // Publishing the week publishes its draft lessons with it.
    await nino.mutation(api.weeks.publish, { weekId: week1 });
    course = await ana.query(api.learn.course, { courseId });
    expect(course.weeks).toEqual([
      expect.objectContaining({
        title: "კვირა 1",
        lessons: [{ _id: lessonId, title: "What is HTML" }],
        links: [expect.objectContaining({ title: "MDN", host: "developer.mozilla.org" })],
      }),
    ]);
    expect(course.assessments.find((a) => a._id === assessmentId)?.weekId).toBe(week1);
    expect(course.materials).toEqual([expect.objectContaining({ title: "MDN", source: "link" })]);
    const read = await ana.query(api.lessons.read, { lessonId });
    expect(read).toMatchObject({ title: "What is HTML", week: { title: "კვირა 1" }, previous: null, next: null });
    await expectAppError(maka.query(api.lessons.read, { lessonId }), "NOT_FOUND");

    // A lesson can be hidden on its own; the week stays.
    await nino.mutation(api.lessons.setStatus, { lessonId, status: "draft" });
    expect((await ana.query(api.learn.course, { courseId })).weeks[0].lessons).toEqual([]);
    void week2;
  });

  test("weeks reorder, and removing a draft week keeps its quizzes (unplaced) but drops its lessons", async () => {
    const { nino, courseId, quiz } = await seed();
    const a = await nino.mutation(api.weeks.create, { courseId, title: "A" });
    const b = await nino.mutation(api.weeks.create, { courseId, title: "B" });
    await nino.mutation(api.weeks.reorder, { courseId, weekIds: [b, a] });
    expect((await outline(nino, courseId)).weeks.map((w) => w.title)).toEqual(["B", "A"]);
    await expectAppError(nino.mutation(api.weeks.reorder, { courseId, weekIds: [a] }), "INVALID_INPUT");

    await nino.mutation(api.lessons.create, { weekId: a, title: "L" });
    const { assessmentId } = await quiz("Q");
    await nino.mutation(api.weeks.place, { assessmentId, weekId: a });
    await nino.mutation(api.weeks.remove, { weekId: a });
    const after = await outline(nino, courseId);
    expect(after.weeks.map((w) => w.title)).toEqual(["B"]);
    expect(after.unplaced.map((x) => x._id)).toContain(assessmentId);
  });

  test("midterms and finals stay in the Exams section", async () => {
    const { nino, courseId } = await seed();
    const week = await nino.mutation(api.weeks.create, { courseId });
    await expectAppError(
      nino.mutation(api.assessments.create, { courseId, kind: "final", title: "Final", weekId: week }),
      "INVALID_INPUT",
    );
    const final = await nino.mutation(api.assessments.create, { courseId, kind: "final", title: "Final" });
    await expectAppError(nino.mutation(api.weeks.place, { assessmentId: final, weekId: week }), "INVALID_INPUT");
    const task = await nino.mutation(api.assessments.create, { courseId, kind: "task", title: "T", weekId: week });
    expect((await outline(nino, courseId)).weeks[0].assessments.map((x) => x._id)).toEqual([task]);
  });

  test("links are checked and can be edited, reordered and removed", async () => {
    const { nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    await expectAppError(nino.mutation(api.weeks.addLinksTo, { weekId, links: [{ title: "x", url: "javascript:alert(1)" }] }), "INVALID_INPUT");
    await expectAppError(nino.mutation(api.weeks.addLinksTo, { weekId, links: [{ title: "x", url: "http://example.com" }] }), "INVALID_INPUT");
    const [first, second] = await nino.mutation(api.weeks.addLinksTo, {
      weekId,
      links: [
        { title: "One", url: "https://one.example.com" },
        { title: "Two", url: "https://two.example.com" },
      ],
    });
    await nino.mutation(api.weeks.moveLinkIn, { weekId, linkId: second, direction: "up" });
    await nino.mutation(api.weeks.updateLinkIn, { weekId, linkId: first, title: "One!", url: "https://one.example.com/x" });
    let links = (await outline(nino, courseId)).weeks[0].links;
    expect(links.map((l) => l.title)).toEqual(["Two", "One!"]);
    await nino.mutation(api.weeks.removeLinkFrom, { weekId, linkId: second });
    links = (await outline(nino, courseId)).weeks[0].links;
    expect(links.map((l) => l.title)).toEqual(["One!"]);
  });

  test("old materials rows become weeks", async () => {
    const { t, nino, courseId } = await seed();
    const ninoId = (await nino.query(api.users.me, {}))!._id;
    await t.run(async (ctx) => {
      await ctx.db.insert("materials", {
        courseId,
        order: 1,
        title: "Old link week",
        source: "link",
        status: "published",
        url: "https://old.example.com",
        createdBy: ninoId,
        createdVia: "web",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("materials", {
        courseId,
        order: 2,
        title: "Old Drive week",
        source: "drive",
        status: "draft",
        folderId: "folderX",
        createdBy: ninoId,
        createdVia: "web",
        updatedAt: Date.now(),
      });
    });
    expect(await t.mutation(internal.migrations.materialsToWeeks, {})).toBe(2);
    expect(await t.mutation(internal.migrations.materialsToWeeks, {})).toBe(0);
    const weeks = (await outline(nino, courseId)).weeks;
    expect(weeks.map((w) => [w.title, w.status, w.links.map((l) => l.url), w.drive?.url !== undefined])).toEqual([
      ["Old link week", "published", ["https://old.example.com"], false],
      ["Old Drive week", "draft", [], true],
    ]);
  });
});

describe("Google Drive folders on weeks", () => {
  test("a folder added after publishing is shared and visible to students", async () => {
    const google = fakeGoogle();
    const { t, nino, ana, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId, title: "Already published" });
    await nino.mutation(api.weeks.publish, { weekId });
    await nino.mutation(api.weeks.addFolder, { weekId });
    expect((await ana.query(api.learn.course, { courseId })).weeks[0].driveUrl).toBeUndefined();
    await settle(t);
    expect((await ana.query(api.learn.course, { courseId })).weeks[0].driveUrl).toBeDefined();
    expect([...google.folders.values()].filter((f) => f.permissions.size > 0).map((f) => f.name))
      .toEqual(["Already published"]);
    expect((await outline(nino, courseId)).weeks[0].drive).toMatchObject({ shared: true });
    await nino.mutation(api.weeks.retry, { weekId });
    await settle(t);
    expect(google.calls.filter((call) => call.startsWith("POST") && call.endsWith("/permissions")))
      .toHaveLength(1);
  });

  test("a folder finishing after its week was hidden stays private", async () => {
    const google = fakeGoogle();
    const { t, nino, ana, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    await nino.mutation(api.weeks.publish, { weekId });
    await nino.mutation(api.weeks.addFolder, { weekId });
    await t.run(async (ctx) => {
      await ctx.db.patch("weeks", weekId, { status: "draft" });
    });
    await settle(t);
    expect([...google.folders.values()].every((f) => f.permissions.size === 0)).toBe(true);
    expect((await ana.query(api.learn.course, { courseId })).weeks).toEqual([]);
  });

  test("a week gets its own folder inside one private course folder, shared by link only once published", async () => {
    const google = fakeGoogle();
    const { t, nino, ana, courseId } = await seed();
    const week1 = await nino.mutation(api.weeks.create, { courseId, title: "Week 1", driveFolder: true });
    const week2 = await nino.mutation(api.weeks.create, { courseId, title: "Week 2", driveFolder: true });
    await settle(t);

    expect(google.folders.size).toBe(3);
    const [root] = [...google.folders.entries()].filter(([, f]) => f.parent === undefined);
    expect(root[1].name).toBe("Kalami · Web basics");
    const staff = await outline(nino, courseId);
    expect(staff.drive).toMatchObject({ mine: true, folderUrl: `https://drive.google.com/drive/folders/${root[0]}` });
    expect(staff.weeks.map((w) => [w.title, w.drive?.syncing, w.drive?.shared, w.drive?.url !== undefined])).toEqual([
      ["Week 1", undefined, false, true],
      ["Week 2", undefined, false, true],
    ]);

    await nino.mutation(api.weeks.publish, { weekId: week1 });
    // Until Drive confirms the sharing, students don't get a link that won't open.
    expect((await ana.query(api.learn.course, { courseId })).weeks[0].driveUrl).toBeUndefined();
    await settle(t);
    expect((await ana.query(api.learn.course, { courseId })).weeks[0].driveUrl).toMatch(/^https:\/\/drive\.google\.com\//);

    // Only Week 1's folder is shared; the course folder and Week 2 stay private.
    const shared = [...google.folders.values()].filter((f) => f.permissions.size > 0);
    expect(shared.map((f) => f.name)).toEqual(["Week 1"]);

    await nino.mutation(api.weeks.unpublish, { weekId: week1 });
    await settle(t);
    expect([...google.folders.values()].every((f) => f.permissions.size === 0)).toBe(true);
    expect((await ana.query(api.learn.course, { courseId })).weeks).toEqual([]);
    void week2;
  });

  test("a busy Google is retried; a missing Drive permission is reported, and retry works after connecting", async () => {
    fakeGoogle({ busyShares: 2 });
    const { t, nino, ana, courseId } = await seed();
    const week = await nino.mutation(api.weeks.create, { courseId, driveFolder: true });
    await settle(t);
    await nino.mutation(api.weeks.publish, { weekId: week });
    await settle(t);
    expect((await ana.query(api.learn.course, { courseId })).weeks[0].driveUrl).toBeDefined();

    vi.unstubAllGlobals();
    fakeGoogle({ scopes: ["openid"] });
    const second = await nino.mutation(api.weeks.create, { courseId, driveFolder: true });
    await settle(t);
    const failed = (await outline(nino, courseId)).weeks.find((w) => w._id === second)!;
    expect(failed.drive?.syncing).toBeUndefined();
    expect(failed.drive?.error).toMatch(/Connect Google Drive/);

    vi.unstubAllGlobals();
    fakeGoogle();
    await nino.mutation(api.weeks.retry, { weekId: second });
    await settle(t);
    const fixed = (await outline(nino, courseId)).weeks.find((w) => w._id === second)!;
    expect(fixed.drive?.error).toBeUndefined();
    expect(fixed.drive?.url).toMatch(/^https:\/\/drive\.google\.com\//);
  });

  test("only the lecturer whose Drive it is can create or share folders; anyone who edits the course can unshare", async () => {
    fakeGoogle();
    const { t, nino, admin, courseId } = await seed();
    const week = await nino.mutation(api.weeks.create, { courseId, driveFolder: true });
    await settle(t);
    const other = await admin.mutation(api.weeks.create, { courseId });
    await expectAppError(admin.mutation(api.weeks.addFolder, { weekId: other }), "FORBIDDEN");
    await expectAppError(admin.mutation(api.weeks.publish, { weekId: week }), "FORBIDDEN");
    await nino.mutation(api.weeks.publish, { weekId: week });
    await settle(t);
    await admin.mutation(api.weeks.unpublish, { weekId: week });
    await settle(t);
    expect((await outline(nino, courseId)).weeks[0]).toMatchObject({ status: "draft", drive: { shared: false } });
  });

  test("without Drive set up on the server, folders are refused and weeks still work", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    const { nino, courseId } = await seed();
    expect((await outline(nino, courseId)).driveAvailable).toBe(false);
    await expectAppError(nino.mutation(api.weeks.create, { courseId, driveFolder: true }), "CONFLICT");
    await nino.mutation(api.weeks.create, { courseId, links: [{ title: "W1", url: "https://example.com/w1" }] });
  });

  test("a course folder deleted in Drive is made again for the next week", async () => {
    const google = fakeGoogle();
    const { t, nino, courseId } = await seed();
    await nino.mutation(api.weeks.create, { courseId, driveFolder: true });
    await settle(t);
    const [rootId] = [...google.folders.entries()].find(([, f]) => f.parent === undefined)!;
    google.folders.delete(rootId);
    const second = await nino.mutation(api.weeks.create, { courseId, driveFolder: true });
    await settle(t);
    expect([...google.folders.values()].filter((f) => f.parent === undefined)).toHaveLength(1);
    const week2 = (await outline(nino, courseId)).weeks.find((w) => w._id === second)!;
    expect(week2.drive?.error).toBeUndefined();
    expect(week2.drive?.url).toBeDefined();
  });

  test("two weeks added at once share one course folder", async () => {
    const google = fakeGoogle();
    const { t, nino, courseId } = await seed();
    await nino.mutation(api.weeks.create, { courseId, driveFolder: true });
    await nino.mutation(api.weeks.create, { courseId, driveFolder: true });
    await settle(t);
    expect([...google.folders.values()].filter((f) => f.parent === undefined)).toHaveLength(1);
  });

  test("a share that lands after the week was hidden is taken straight back off", async () => {
    const google = fakeGoogle();
    const { t, nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId, driveFolder: true });
    await settle(t);
    await nino.mutation(api.weeks.publish, { weekId });
    await t.run(async (ctx) => {
      await ctx.db.patch("weeks", weekId, { status: "draft", syncing: undefined, syncingSince: undefined });
    });
    await t.mutation(internal.drive.report, { weekId, job: "share", permissionId: "late-perm", clearSyncing: true });
    await settle(t);
    const row = await t.run(async (ctx) => await ctx.db.get("weeks", weekId));
    expect(row).toMatchObject({ status: "draft" });
    expect(row?.permissionId).toBeUndefined();
    expect([...google.folders.values()].every((f) => f.permissions.size === 0)).toBe(true);
  });

  test("when the Drive owner leaves, another editor moves the course to their own Drive", async () => {
    fakeGoogle();
    const { t, nino, admin, courseId } = await seed();
    await nino.mutation(api.weeks.create, { courseId, driveFolder: true });
    await settle(t);
    await t.mutation(internal.users.deleteFromClerk, { clerkUserId: "nino" });
    const before = await outline(admin, courseId);
    expect(before.drive).toMatchObject({ mine: false, canTakeOver: true });
    await admin.mutation(api.weeks.moveToMyDrive, { courseId });
    await settle(t);
    const after = await outline(admin, courseId);
    expect(after.drive).toMatchObject({ mine: true });
    expect(after.weeks[0]).toMatchObject({ status: "draft", drive: { shared: false } });
    expect(after.weeks[0].drive?.url).toBeDefined();
  });
});
