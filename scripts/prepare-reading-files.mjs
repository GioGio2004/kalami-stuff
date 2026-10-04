// Admin maintenance tool. Defaults to a local preview; --upload writes only
// lesson reading files, never assessments, grades or student information.
// Run with: node --experimental-transform-types scripts/prepare-reading-files.mjs
//   <courseId> <outputDirectory> [--upload]
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFolder, googleAccessToken } from "../convex/lib/google.ts";

const [courseId, outputDirectory, flag] = process.argv.slice(2);
if (!/^[a-z0-9]+$/.test(courseId ?? "") || !outputDirectory || (flag && flag !== "--upload")) {
  throw new Error("Usage: <courseId> <outputDirectory> [--upload]");
}
const repo = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(repo, "node_modules/convex/bin/main.js");
function convex(...args) {
  // No shell interpolation, and secrets returned by env get stay in memory.
  return execFileSync(process.execPath, [cli, ...args, "--prod"], {
    cwd: repo, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function query(source) {
  return JSON.parse(convex("run", "--inline-query", source));
}
const snapshot = query(`
  const course = await ctx.db.get("courses", "${courseId}");
  if (!course) throw new Error("Course missing");
  const weeks = await ctx.db.query("weeks").withIndex("by_courseId_and_order", q => q.eq("courseId", course._id)).collect();
  const lessons = await ctx.db.query("lessons").withIndex("by_courseId", q => q.eq("courseId", course._id)).collect();
  const drive = await ctx.db.query("courseDrive").withIndex("by_courseId", q => q.eq("courseId", course._id)).unique();
  const owner = drive ? await ctx.db.get("users", drive.ownerId) : null;
  return {course: {title: course.title, status: course.status}, weeks, lessons,
    rootFolderId: drive?.folderId ?? null, ownerClerkId: owner?.deletedAt === undefined ? owner?.clerkUserId ?? null : null};
`);

function blockText(block) {
  switch (block.type) {
    case "text": return block.md;
    case "callout": return `> **${block.title ?? block.tone}**\n> ${block.md.replaceAll("\n", "\n> ")}`;
    case "code": {
      const fence = "`".repeat(Math.max(3, ...[...block.code.matchAll(/`+/g)].map(m => m[0].length + 1)));
      return `${block.caption ? `${block.caption}\n\n` : ""}${fence}${block.language}\n${block.code}\n${fence}`;
    }
    case "image": return `![${block.alt.replaceAll("]", "\\]")}](${block.url})${block.caption ? `\n\n${block.caption}` : ""}`;
    case "video": return `[${block.caption ?? "Watch the video"}](${block.url})`;
    case "steps": return `${block.title ? `### ${block.title}\n\n` : ""}${block.steps.map((step, i) => `**${i + 1}. ${step.title ?? "Step"}**\n\n${step.md}`).join("\n\n")}`;
    case "check": return `### Check your understanding\n\n${block.check.prompt}\n\n${(block.check.options ?? []).map(o => `- ${o.text}`).join("\n")}\n\nTry this check in Kalami for feedback.`;
    default: throw new Error(`Unsupported lesson block: ${block.type}`);
  }
}

mkdirSync(outputDirectory, { recursive: true });
const documents = [];
for (const [weekIndex, week] of snapshot.weeks.sort((a, b) => a.order - b.order).entries()) {
  const lessons = snapshot.lessons.filter(l => l.weekId === week._id).sort((a, b) => a.order - b.order);
  // A draft lesson inside a published week must never enter its shared folder.
  for (const visibility of ["published", "draft"]) {
    const selected = lessons.filter(l =>
      (snapshot.course.status !== "draft" && week.status === "published" && l.status === "published") === (visibility === "published"));
    if (!selected.length) continue;
    const content = [
      `# ${week.title}`, snapshot.course.title,
      visibility === "draft" ? "Draft reading material — not released to students." : "Reading material for this week.",
      "Exported from the Kalami lessons. Interactive previews and exercise feedback are available in the course.",
      week.description ?? "",
      ...selected.map(l => `## ${l.title}\n\n${l.blocks.map(blockText).join("\n\n")}`),
      week.links.length ? `## Further reading\n\n${week.links.map(l => `- [${l.title}](${l.url})`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n") + "\n";
    const filename = `${String(weekIndex + 1).padStart(2, "0")}-${week.title.replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "")}-${visibility}.md`;
    writeFileSync(resolve(outputDirectory, filename), content, "utf8");
    documents.push({ weekId: week._id, title: week.title, filename, visibility, lessons: selected.length,
      folderId: visibility === "published" && week.permissionId ? week.folderId : undefined,
      content, hash: createHash("sha256").update(content).digest("hex") });
  }
}
const manifest = documents.map(doc => Object.fromEntries(Object.entries(doc).filter(([key]) => key !== "content")));
writeFileSync(resolve(outputDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Prepared ${documents.length} reading files covering ${documents.reduce((n, d) => n + d.lessons, 0)} lessons.`);

if (flag === "--upload") {
  if (!snapshot.ownerClerkId || !snapshot.rootFolderId) throw new Error("Connect the course owner's Drive first.");
  process.env.CLERK_SECRET_KEY = convex("env", "get", "CLERK_SECRET_KEY");
  const token = await googleAccessToken(snapshot.ownerClerkId);
  delete process.env.CLERK_SECRET_KEY;
  async function google(path, init = {}) {
    const response = await fetch(`https://www.googleapis.com/${path}`, {
      ...init, signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const reason = error.error?.errors?.[0]?.reason ?? "unknown";
      throw new Error(`Google Drive request failed (${response.status}, ${reason}): ${error.error?.message ?? "No detail"}`);
    }
    return await response.json();
  }
  async function requirePrivate(folderId) {
    const result = await google(`drive/v3/files/${folderId}/permissions?fields=permissions(type)`);
    if (result.permissions?.some(p => p.type === "anyone" || p.type === "domain")) {
      throw new Error("Draft destination is broadly shared; refusing to upload drafts.");
    }
  }
  await requirePrivate(snapshot.rootFolderId);
  let draftsFolder;
  const uploaded = [];
  for (const doc of documents) {
    let parent = doc.folderId;
    if (doc.visibility === "draft") {
      draftsFolder ??= await ensureFolder(token, `reading-drafts-${courseId}`, "Draft reading files", snapshot.rootFolderId);
      await requirePrivate(draftsFolder);
      parent = draftsFolder;
    }
    if (!parent) throw new Error(`Publish and share the folder for ${doc.title} before uploading student materials.`);
    const tag = createHash("sha256").update(`${doc.weekId}:${doc.visibility}:${doc.hash}`).digest("hex");
    const search = new URLSearchParams({ q: `'${parent}' in parents and appProperties has { key='kalamiReading' and value='${tag}' } and trashed=false`, fields: "files(id,webViewLink)", pageSize: "100" });
    const existing = await google(`drive/v3/files?${search}`);
    let file = existing.files?.[0];
    if (!file) {
      const boundary = `kalami_${randomUUID()}`;
      const metadata = { name: doc.filename, parents: [parent], mimeType: "text/markdown", appProperties: { kalamiReading: tag } };
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${doc.content}\r\n--${boundary}--`;
      file = await google("upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
        method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
      });
    }
    const downloaded = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!downloaded.ok || createHash("sha256").update(await downloaded.text()).digest("hex") !== doc.hash) {
      throw new Error(`Uploaded file verification failed: ${doc.filename}`);
    }
    const permissions = await google(`drive/v3/files/${file.id}/permissions?fields=permissions(type,role)`);
    const publicRead = permissions.permissions?.some(p => p.type === "anyone" && p.role === "reader");
    if (doc.visibility === "published" && !publicRead) throw new Error(`Student file is not readable by link: ${doc.filename}`);
    if (doc.visibility === "draft") await requirePrivate(file.id);
    uploaded.push({ filename: doc.filename, visibility: doc.visibility, id: file.id, verified: true, url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view` });
    writeFileSync(resolve(outputDirectory, "uploaded.json"), JSON.stringify(uploaded, null, 2));
    console.log(`${existing.files?.length ? "Already uploaded" : "Uploaded"}: ${doc.filename}`);
  }
  console.log(`Course folder: https://drive.google.com/drive/folders/${snapshot.rootFolderId}`);
}
