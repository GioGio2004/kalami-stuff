/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { expectAppError, person, seed, type TestBackend } from "./test.setup";

// The database side of copying pictures in (model/media.ts). The Node part
// (download, sharp, ImageKit) is covered by lib/media/pipeline.test.ts and was
// run for real against the dev deployment; here the internal steps it calls
// are driven directly.

const SECRET = "test-service-secret-0123456789abcdef";
beforeEach(() => vi.stubEnv("MCP_SERVICE_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function credential(clerkUserId: string) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: clerkUserId, e: Date.now() + 60_000 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `svc.${payload}.${b64url(signature)}`;
}

const KALAMI = (name: string) => `https://ik.imagekit.io/kalami/test/courses/c/${name}.webp`;

/** What mediaActions does after a "new" start: the file is on ImageKit, so it's recorded. */
async function copyIn(t: TestBackend, as: string, courseId: Id<"courses">, link: string, name: string) {
  const started = await t.withIdentity(person(as)).mutation(internal.media.start, {
    caller: { kind: "web" },
    target: { courseId },
    link,
  });
  if (started.kind !== "new") throw new Error("expected a new picture");
  return await t.mutation(internal.media.record, {
    courseId: started.courseId,
    ownerId: started.ownerId,
    via: started.via,
    fileId: `file_${name}`,
    url: KALAMI(name),
    width: 1600,
    height: 900,
    bytes: 180_000,
    originalBytes: 2_400_000,
    source: { kind: "link", url: link },
    sourceKey: started.sourceKey,
  });
}

async function scheduledDeletes(t: TestBackend) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").take(100))
      .filter((job) => job.name.includes("deleteFiles"))
      .map((job) => job.args[0] as { fileIds: string[] }),
  );
}

describe("copying pictures into Kalami", () => {
  test("the same link in the same course is copied once; a Kalami picture is used as it is", async () => {
    const { t, courseId } = await seed();
    const first = await copyIn(t, "nino", courseId, "https://upload.example.org/cat.jpg#x", "cat");
    expect(first).toMatchObject({ url: KALAMI("cat"), reused: false, bytes: 180_000, originalBytes: 2_400_000 });

    const nino = t.withIdentity(person("nino"));
    const again = await nino.mutation(internal.media.start, {
      caller: { kind: "web" },
      target: { courseId },
      link: "https://upload.example.org/cat.jpg",
    });
    expect(again).toEqual({ kind: "reuse", result: { ...first, reused: true } });
    const kalami = await nino.mutation(internal.media.start, { caller: { kind: "web" }, target: { courseId }, link: KALAMI("cat") });
    expect(kalami.kind).toBe("reuse");
  });

  test("links that can't be fetched safely are refused before anything is downloaded", async () => {
    const { t, courseId } = await seed();
    const nino = t.withIdentity(person("nino"));
    for (const link of ["http://example.com/a.png", "https://localhost/a.png", "https://10.0.0.8/a.png", "nonsense"]) {
      await expectAppError(nino.mutation(internal.media.start, { caller: { kind: "web" }, target: { courseId }, link }), "INVALID_INPUT");
    }
  });

  test("only the course's editors copy pictures in, people and agents alike", async () => {
    const { t, courseId } = await seed();
    await expectAppError(
      t.withIdentity(person("ana")).mutation(internal.media.start, { caller: { kind: "web" }, target: { courseId } }),
      "FORBIDDEN",
    );
    await expectAppError(
      t.mutation(internal.media.start, { caller: { kind: "agent", token: "svc.forged.token" }, target: { courseId } }),
      "UNAUTHENTICATED",
    );
    const weekId = await t.withIdentity(person("nino")).mutation(api.weeks.create, { courseId });
    const started = await t.mutation(internal.media.start, {
      caller: { kind: "agent", token: await credential("nino") },
      target: { weekId },
      link: "https://example.org/a.png",
    });
    expect(started).toMatchObject({ kind: "new", courseId, via: "mcp" });
  });

  test("each lecturer has a budget of new pictures", async () => {
    const { t, courseId } = await seed();
    const nino = t.withIdentity(person("nino"));
    for (let i = 0; i < 30; i++) {
      await nino.mutation(internal.media.start, { caller: { kind: "web" }, target: { courseId } });
    }
    await expectAppError(nino.mutation(internal.media.start, { caller: { kind: "web" }, target: { courseId } }), "RATE_LIMITED");
  });
});

describe("pictures in presentations", () => {
  test("new image slides must show a picture copied into Kalami; links a deck already had may stay", async () => {
    const { t, nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    const presentationId = await nino.mutation(api.presentations.create, { weekId, title: "Cats" });
    const outside = { type: "image" as const, url: "https://example.org/cat.png", alt: "A cat" };

    const refused = await nino.mutation(api.presentations.save, { presentationId, slides: [outside] }).catch((e: { data?: { message?: string } }) => e.data?.message);
    expect(refused).toContain("slides[0].url: the picture on example.org has to be copied into Kalami first.");

    await copyIn(t, "nino", courseId, "https://example.org/cat.png", "cat");
    await nino.mutation(api.presentations.save, {
      presentationId,
      slides: [{ ...outside, url: KALAMI("cat"), credit: "  Photo: Jane Doe / Unsplash " }],
    });
    expect((await nino.query(api.presentations.get, { presentationId })).slides[0]).toMatchObject({
      url: KALAMI("cat"),
      credit: "Photo: Jane Doe / Unsplash",
    });

    // A deck from before pictures were copied in keeps its link until the lecturer copies it.
    await t.run(async (ctx) => {
      await ctx.db.patch("presentations", presentationId, { slides: [{ id: "old", ...outside }] });
    });
    await nino.mutation(api.presentations.save, { presentationId, slides: [{ id: "old", ...outside, title: "Still here" }] });
    await expectAppError(
      nino.mutation(api.presentations.save, { presentationId, slides: [{ id: "old", ...outside, url: "https://example.org/dog.png" }] }),
      "INVALID_INPUT",
    );
  });

  test("agents can't save links to other sites either", async () => {
    const { nino, courseId } = await seed();
    const weekId = await nino.mutation(api.weeks.create, { courseId });
    await expectAppError(
      nino.mutation(api.mcp.createPresentationAsAgent, {
        token: await credential("nino"),
        weekId,
        title: "Cats",
        slides: [{ type: "image", url: "https://example.org/cat.png", alt: "A cat" }],
      }),
      "INVALID_INPUT",
    );
  });

  test("a picture shared by two courses is deleted from ImageKit only when the last of them goes", async () => {
    const { t, nino, courseId } = await seed();
    await copyIn(t, "nino", courseId, "https://example.org/cat.png", "cat");
    await copyIn(t, "nino", courseId, "https://example.org/dog.png", "dog");

    // A second course shows the cat too (say, a deck imported from a file): it gets its own row for the same file.
    const otherId = await nino.mutation(api.courses.create, { title: "Web basics, again" });
    const weekId = await nino.mutation(api.weeks.create, { courseId: otherId });
    await nino.mutation(api.presentations.create, { weekId, title: "Cats" }).then((presentationId) =>
      nino.mutation(api.presentations.save, { presentationId, slides: [{ type: "image", url: KALAMI("cat"), alt: "A cat" }] }),
    );

    await nino.mutation(api.courses.remove, { courseId });
    await t.mutation(internal.courses.purge, { courseId });
    expect(await scheduledDeletes(t)).toEqual([{ fileIds: ["file_dog"] }]);

    await nino.mutation(api.courses.remove, { courseId: otherId });
    await t.mutation(internal.courses.purge, { courseId: otherId });
    expect(await scheduledDeletes(t)).toEqual([{ fileIds: ["file_dog"] }, { fileIds: ["file_cat"] }]);
    expect(await t.run(async (ctx) => (await ctx.db.query("media").take(100)).length)).toBe(0);
  });
});
