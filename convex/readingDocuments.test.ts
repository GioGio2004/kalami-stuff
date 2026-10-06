import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { seed, expectAppError, settle } from "./test.setup";
import { DRIVE_SCOPE } from "./lib/google";
import { readingHtml } from "./lib/readingDocument";

const SECRET = "reading-test-service-secret-0123456789";
beforeEach(() => { vi.stubEnv("MCP_SERVICE_SECRET", SECRET); vi.stubEnv("CLERK_SECRET_KEY", "test"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function credential(user = "nino") {
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payload = b64(new TextEncoder().encode(JSON.stringify({ u: user, e: Date.now() + 60_000 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `svc.${payload}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))}`;
}

async function setup() {
  const s = await seed();
  const weekId = await s.nino.mutation(api.weeks.create, { courseId: s.courseId });
  await s.t.run(async (ctx) => {
    const user = await ctx.db.query("users").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "nino")).unique();
    await ctx.db.insert("courseDrive", { courseId: s.courseId, ownerId: user!._id, folderId: "root", updatedAt: Date.now() });
    await ctx.db.patch("weeks", weekId, { folderId: "week" });
  });
  const args = { weekId, token: await credential(), documentKey: "html-reading", title: "HTML reading", content: "# Start here\nHTML describes structure.\n- Tags\n```html\n<h1>Hello</h1>\n```" };
  return { ...s, weekId, args };
}

function google(options: { lostCreate?: boolean; failCreate?: boolean; publicFolder?: boolean; scopeMissing?: boolean; failUpload?: boolean } = {}) {
  type File = { id: string; mimeType: string; parents: string[]; permissions: { type: string; role: string }[]; appProperties?: Record<string, string> };
  const owner = [{ type: "user", role: "owner" }];
  const files = new Map<string, File>([
    ["root", { id: "root", mimeType: "application/vnd.google-apps.folder", parents: [], permissions: owner }],
    ["week", { id: "week", mimeType: "application/vnd.google-apps.folder", parents: ["root"], permissions: options.publicFolder ? [...owner, { type: "anyone", role: "reader" }] : owner }],
  ]);
  const uploads: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  let creates = 0;
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.host === "api.clerk.com") return json([{ token: "google", scopes: options.scopeMissing ? [] : [DRIVE_SCOPE] }]);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer google");
    const id = url.pathname.split("/").at(-1)!;
    if (id === "permissions" && method === "POST") {
      files.get(url.pathname.split("/").at(-2)!)!.permissions.push({ type: "anyone", role: "reader" });
      return json({ id: "public-permission" });
    }
    if (id === "files" && method === "GET") {
      const tag = /value='([^']+)'/.exec(url.searchParams.get("q") ?? "")?.[1];
      return json({ files: [...files.values()].filter((f) => (f.appProperties?.kalamiReading ?? f.appProperties?.kalami) === tag).map((f) => ({ id: f.id })) });
    }
    if (id === "files" && method === "POST") {
      creates++;
      if (options.failCreate) return json({}, 403);
      const body = JSON.parse(String(init?.body));
      if (body.mimeType === "application/vnd.google-apps.folder") {
        const id = `folder-${creates}`;
        files.set(id, { ...body, id, permissions: [...owner] });
        return json({ id });
      }
      files.set("doc", { ...body, id: "doc", parents: ["mydrive"], permissions: owner });
      if (options.lostCreate) { options.lostCreate = false; throw new Error("response lost"); }
      return json({ id: "doc" });
    }
    if (url.pathname.includes("/upload/")) {
      if (options.failUpload) { options.failUpload = false; return json({}, 503); }
      uploads.push(String(init?.body));
      return json({ id });
    }
    if (method === "PATCH") {
      files.get(id)!.parents = [url.searchParams.get("addParents")!];
      return json({ id });
    }
    return json(files.get(id));
  });
  vi.stubGlobal("fetch", mock);
  return { files, uploads, mock, creates: () => creates };
}

test("creates a private native Doc, links it once and revises the same ID", async () => {
  const { t, args, weekId, ana, nino, courseId } = await setup();
  const g = google();
  const first = await t.action(api.readingDocuments.saveAsAgent, args);
  const second = await t.action(api.readingDocuments.saveAsAgent, { ...args, content: "Updated reading" });
  expect(second).toEqual(first);
  expect(g.creates()).toBe(1);
  expect(g.files.get("doc")).toMatchObject({ mimeType: "application/vnd.google-apps.document", parents: ["week"], permissions: [{ role: "owner" }] });
  expect(g.uploads[0]).toContain("&lt;h1&gt;Hello&lt;/h1&gt;");
  expect(g.uploads[1]).toContain("Updated reading");
  const week = await t.run((ctx) => ctx.db.get("weeks", weekId));
  expect(week?.links).toHaveLength(1);
  expect(week?.links[0].url).toBe(first.url);
  expect(week?.readingWrite).toBeUndefined();
  expect((await ana.query(api.learn.course, { courseId })).weeks).toEqual([]);
  expect(await t.query(api.readingDocuments.listForAgent, { token: args.token, weekId })).toEqual([{ documentKey: "html-reading", url: first.url, linked: true }]);
  await nino.mutation(api.weeks.publish, { weekId });
  await settle(t);
  expect((await ana.query(api.learn.course, { courseId })).weeks[0].links[0].url).toBe(first.url);
  expect(g.files.get("week")?.permissions).toContainEqual({ type: "anyone", role: "reader" });
});

test("the agent prepares a new draft week folder without a dashboard click", async () => {
  const { t, nino, args, courseId } = await setup();
  const g = google();
  const weekId = await nino.mutation(api.weeks.create, { courseId });
  await t.mutation(api.mcp.prepareWeekDriveAsAgent, { token: args.token, weekId });
  await settle(t);
  const week = await t.run((ctx) => ctx.db.get("weeks", weekId));
  expect(week?.folderId).toBeDefined();
  expect(week?.syncing).toBeUndefined();
  expect(g.files.get(week!.folderId!)?.parents).toEqual(["root"]);
  const count = g.creates();
  await t.mutation(api.mcp.prepareWeekDriveAsAgent, { token: args.token, weekId });
  expect(g.creates()).toBe(count);
  await t.run((ctx) => ctx.db.patch("weeks", weekId, { status: "published" }));
  await expectAppError(t.mutation(api.mcp.prepareWeekDriveAsAgent, { token: args.token, weekId }), "CONFLICT");
});

test("recovers a lost creation response without posting another file", async () => {
  const { t, args } = await setup();
  const g = google({ lostCreate: true });
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, args), "CONFLICT");
  expect((await t.action(api.readingDocuments.saveAsAgent, args)).documentId).toBe("doc");
  expect(g.creates()).toBe(1);
});

test("retries a failed upload using the existing private document", async () => {
  const { t, args } = await setup();
  const g = google({ failUpload: true });
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, args), "CONFLICT");
  expect(g.files.get("doc")?.parents).toEqual(["mydrive"]);
  await t.action(api.readingDocuments.saveAsAgent, args);
  expect(g.creates()).toBe(1);
});

test("a definitive rejected creation may be retried; an ambiguous one cannot duplicate", async () => {
  const { t, args } = await setup();
  const options = { failCreate: true };
  const g = google(options);
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, args), "CONFLICT");
  options.failCreate = false;
  await t.action(api.readingDocuments.saveAsAgent, args);
  expect(g.creates()).toBe(2);
  const row = await t.run((ctx) => ctx.db.query("readingDocuments").first());
  await t.run((ctx) => ctx.db.patch("readingDocuments", row!._id, { documentId: undefined, createAttempted: true }));
  g.files.delete("doc");
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, args), "CONFLICT");
  expect(g.creates()).toBe(2);
});

test("refuses unauthenticated callers, students, other Drive owners and published weeks", async () => {
  const { t, args, weekId } = await setup();
  const g = google();
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, { ...args, token: "invalid" }), "UNAUTHENTICATED");
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, { ...args, token: await credential("ana") }), "UNAUTHENTICATED");
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, { ...args, token: await credential("admin") }), "FORBIDDEN");
  await t.run((ctx) => ctx.db.patch("weeks", weekId, { status: "published" }));
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, args), "CONFLICT");
  expect(g.mock).not.toHaveBeenCalled();
});

test("missing OAuth scope and public draft folders fail before file creation", async () => {
  const { t, args } = await setup();
  let g = google({ scopeMissing: true });
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, args), "CONFLICT");
  expect(g.creates()).toBe(0);
  g = google({ publicFolder: true });
  await expectAppError(t.action(api.readingDocuments.saveAsAgent, args), "CONFLICT");
  expect(g.creates()).toBe(0);
});

test("in-flight save blocks another writer, publication, deletion and link changes", async () => {
  const { t, nino, args, weekId } = await setup();
  await t.mutation(internal.readingDocuments.begin, { ...args, runId: "run" });
  await expectAppError(t.mutation(internal.readingDocuments.begin, { ...args, runId: "other" }), "CONFLICT");
  await expectAppError(nino.mutation(api.weeks.publish, { weekId }), "CONFLICT");
  await expectAppError(t.mutation(api.mcp.deleteWeekAsAgent, { token: args.token, weekId }), "CONFLICT");
  await expectAppError(t.mutation(api.mcp.addWeekLinksAsAgent, { token: args.token, weekId, links: [{ title: "Other", url: "https://example.com" }] }), "CONFLICT");
  await t.mutation(internal.readingDocuments.release, { weekId, runId: "other" });
  await expectAppError(nino.mutation(api.weeks.publish, { weekId }), "CONFLICT");
});

test("formats safe headings, bullets and code without executing HTML", () => {
  const html = readingHtml("<Title>", "# Heading\n- one\n<script>alert(1)</script>\n```\n<p>code</p>");
  expect(html).toContain("<h1>&lt;Title&gt;</h1>");
  expect(html).toContain("<h1>Heading</h1>");
  expect(html).toContain("<li>one</li>");
  expect(html).not.toContain("<script>");
  expect(html).toContain("</pre></body>");
});
