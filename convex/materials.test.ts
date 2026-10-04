/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
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

async function weeks(nino: Awaited<ReturnType<typeof seed>>["nino"], courseId: Id<"courses">) {
  return (await nino.query(api.materials.forCourse, { courseId, now: Date.now() })).weeks;
}

describe("link materials", () => {
  test("students see a published link with its host, and nothing while it's a draft", async () => {
    const { nino, ana, maka, courseId } = await seed();
    await expectAppError(
      nino.mutation(api.materials.addLink, { courseId, title: "Week 1", url: "javascript:alert(1)" }),
      "INVALID_INPUT",
    );
    await expectAppError(
      nino.mutation(api.materials.addLink, { courseId, title: "Week 1", url: "http://example.com/x" }),
      "INVALID_INPUT",
    );
    const materialId = await nino.mutation(api.materials.addLink, {
      courseId,
      title: "Week 1",
      url: "https://onedrive.live.com/folder",
    });
    expect((await ana.query(api.learn.course, { courseId })).materials).toEqual([]);
    await nino.mutation(api.materials.publish, { materialId });
    expect((await ana.query(api.learn.course, { courseId })).materials).toEqual([
      expect.objectContaining({ title: "Week 1", host: "onedrive.live.com", source: "link" }),
    ]);
    await expectAppError(maka.query(api.learn.course, { courseId }), "NOT_FOUND");
    await expectAppError(nino.mutation(api.materials.remove, { materialId }), "CONFLICT");
    await nino.mutation(api.materials.unpublish, { materialId });
    expect((await ana.query(api.learn.course, { courseId })).materials).toEqual([]);
    await nino.mutation(api.materials.remove, { materialId });
    expect(await weeks(nino, courseId)).toEqual([]);
  });

  test("weeks keep their order and can be moved", async () => {
    const { nino, courseId } = await seed();
    const a = await nino.mutation(api.materials.addLink, { courseId, title: "A", url: "https://a.example.com" });
    await nino.mutation(api.materials.addLink, { courseId, title: "B", url: "https://b.example.com" });
    await nino.mutation(api.materials.move, { materialId: a, direction: "down" });
    expect((await weeks(nino, courseId)).map((w) => w.title)).toEqual(["B", "A"]);
  });
});

describe("Google Drive materials", () => {
  test("a week gets its own folder inside one private course folder, shared by link only once published", async () => {
    const google = fakeGoogle();
    const { t, nino, ana, courseId } = await seed();
    const week1 = await nino.mutation(api.materials.addDrive, { courseId, title: "Week 1" });
    const week2 = await nino.mutation(api.materials.addDrive, { courseId, title: "Week 2" });
    await settle(t);

    expect(google.folders.size).toBe(3);
    const [root] = [...google.folders.entries()].filter(([, f]) => f.parent === undefined);
    expect(root[1].name).toBe("Kalami · Web basics");
    const listed = await nino.query(api.materials.forCourse, { courseId, now: Date.now() });
    expect(listed.drive).toMatchObject({ mine: true, folderUrl: `https://drive.google.com/drive/folders/${root[0]}` });
    expect(listed.weeks.map((w) => [w.title, w.syncing, w.shared, w.url !== undefined])).toEqual([
      ["Week 1", undefined, false, true],
      ["Week 2", undefined, false, true],
    ]);

    await nino.mutation(api.materials.publish, { materialId: week1 });
    // Until Drive confirms the sharing, students don't get a link that won't open.
    expect((await ana.query(api.learn.course, { courseId })).materials).toEqual([]);
    await settle(t);
    const materials = (await ana.query(api.learn.course, { courseId })).materials;
    expect(materials).toEqual([expect.objectContaining({ title: "Week 1", host: "drive.google.com", source: "drive" })]);

    // Only Week 1's folder is shared; the course folder and Week 2 stay private.
    const shared = [...google.folders.values()].filter((f) => f.permissions.size > 0);
    expect(shared.map((f) => f.name)).toEqual(["Week 1"]);

    await nino.mutation(api.materials.unpublish, { materialId: week1 });
    await settle(t);
    expect([...google.folders.values()].every((f) => f.permissions.size === 0)).toBe(true);
    expect((await ana.query(api.learn.course, { courseId })).materials).toEqual([]);
    expect(google.calls.filter((c) => c.startsWith("DELETE"))).toHaveLength(1);
    void week2;
  });

  test("a busy Google is retried by itself; a missing Drive permission is reported, and retry works after connecting", async () => {
    fakeGoogle({ busyShares: 2 });
    const { t, nino, ana, courseId } = await seed();
    const week = await nino.mutation(api.materials.addDrive, { courseId, title: "Week 1" });
    await settle(t);
    await nino.mutation(api.materials.publish, { materialId: week });
    await settle(t);
    expect((await ana.query(api.learn.course, { courseId })).materials).toHaveLength(1);

    vi.unstubAllGlobals();
    fakeGoogle({ scopes: ["openid"] });
    const second = await nino.mutation(api.materials.addDrive, { courseId, title: "Week 2" });
    await settle(t);
    const failed = (await weeks(nino, courseId)).find((w) => w._id === second)!;
    expect(failed.syncing).toBeUndefined();
    expect(failed.driveError).toMatch(/Connect Google Drive/);

    vi.unstubAllGlobals();
    fakeGoogle();
    await nino.mutation(api.materials.retry, { materialId: second });
    await settle(t);
    const fixed = (await weeks(nino, courseId)).find((w) => w._id === second)!;
    expect(fixed.driveError).toBeUndefined();
    expect(fixed.url).toMatch(/^https:\/\/drive\.google\.com\//);
  });

  test("only the lecturer whose Drive it is can create or share folders; anyone who edits the course can unshare", async () => {
    fakeGoogle();
    const { t, nino, admin, courseId } = await seed();
    const week = await nino.mutation(api.materials.addDrive, { courseId, title: "Week 1" });
    await settle(t);
    await expectAppError(admin.mutation(api.materials.addDrive, { courseId, title: "Mine" }), "FORBIDDEN");
    await expectAppError(admin.mutation(api.materials.publish, { materialId: week }), "FORBIDDEN");
    await nino.mutation(api.materials.publish, { materialId: week });
    await settle(t);
    await admin.mutation(api.materials.unpublish, { materialId: week });
    await settle(t);
    expect((await weeks(nino, courseId))[0]).toMatchObject({ status: "draft", shared: false });
  });

  test("without Drive set up on the server, Drive weeks are refused and links still work", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    const { nino, courseId } = await seed();
    expect((await nino.query(api.materials.forCourse, { courseId, now: Date.now() })).driveAvailable).toBe(false);
    await expectAppError(nino.mutation(api.materials.addDrive, { courseId, title: "Week 1" }), "CONFLICT");
    await nino.mutation(api.materials.addLink, { courseId, title: "Week 1", url: "https://example.com/w1" });
  });
});
