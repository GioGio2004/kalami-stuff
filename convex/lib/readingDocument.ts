import { DriveError } from "./google";

const API = "https://www.googleapis.com/drive/v3/files";
const DOC = "application/vnd.google-apps.document";

export class ReadingHttpError extends DriveError {
  constructor(readonly status: number, message: string) { super(message); }
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Deliberately small, safe Markdown subset. Raw HTML is always escaped. */
export function readingHtml(title: string, content: string): string {
  let code = false;
  const lines = content.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    if (/^```/.test(line)) {
      code = !code;
      return code ? "<pre>" : "</pre>";
    }
    if (code) return `${escape(line)}\n`;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) return `<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>`;
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (bullet) return `<ul><li>${escape(bullet[1])}</li></ul>`;
    return line.trim() ? `<p>${escape(line)}</p>` : "<p><br></p>";
  });
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>${escape(title)}</h1>${lines.join("\n")}${code ? "</pre>" : ""}</body></html>`;
}

async function request(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init, signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new DriveError("Google Drive did not respond. Retry with the same documentKey to recover safely.");
  }
  if (!response.ok) {
    throw new ReadingHttpError(response.status, response.status === 401
      ? "Reconnect Google Drive in the staff app, then retry with the same documentKey."
      : `Google Drive rejected the reading request (${response.status}). Check the Google connection and file access, then retry with the same documentKey.`);
  }
  return response;
}

type File = { id: string; mimeType: string; trashed?: boolean; parents?: string[]; appProperties?: Record<string, string>; permissions?: { role: string; type: string }[] };
async function file(token: string, id: string): Promise<File> {
  return await (await request(token, `${API}/${encodeURIComponent(id)}?fields=id,mimeType,trashed,parents,appProperties,permissions(type,role)`)).json();
}

function privateFile(row: File) {
  if (row.trashed || !row.permissions?.length || row.permissions.some((p) => p.role !== "owner")) {
    throw new DriveError("Draft readings require private files and folders. Remove sharing in Google Drive before retrying.");
  }
}

export async function requirePrivateReadingFolder(token: string, folderId: string, rootId: string) {
  const [folder, root] = await Promise.all([file(token, folderId), file(token, rootId)]);
  privateFile(folder);
  privateFile(root);
  if (folder.mimeType !== "application/vnd.google-apps.folder" || root.mimeType !== "application/vnd.google-apps.folder" || !folder.parents?.includes(rootId)) {
    throw new DriveError("The week's folder was moved. Restore it inside its Kalami course folder before saving readings.");
  }
}

export async function findReading(token: string, key: string): Promise<string | undefined> {
  const q = `appProperties has { key='kalamiReading' and value='${key.replace(/[^A-Za-z0-9_-]/g, "")}' } and trashed=false`;
  const result = await (await request(token, `${API}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=2`)).json() as { files?: { id: string }[] };
  if ((result.files?.length ?? 0) > 1) throw new DriveError("Multiple readings have the same Kalami tag. Resolve the duplicate in Drive first.");
  return result.files?.[0]?.id;
}

/** Created in My Drive, away from the week, until its content has been saved. */
export async function createReading(token: string, key: string, title: string): Promise<string> {
  const result = await (await request(token, API + "?fields=id", {
    method: "POST", body: JSON.stringify({ name: title, mimeType: DOC, appProperties: { kalamiReading: key } }),
  })).json() as { id: string };
  return result.id;
}

export async function writeReading(token: string, id: string, key: string, title: string, content: string, folderId: string) {
  const row = await file(token, id);
  privateFile(row);
  if (row.mimeType !== DOC || row.appProperties?.kalamiReading !== key) throw new DriveError("This file is not the reading managed by Kalami.");
  // Google documents that upload-and-convert updates replace the full content.
  // The immutable ID and link survive. No Docs API or additional OAuth scope needed.
  const boundary = `kalami_${crypto.randomUUID()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: title, mimeType: DOC })}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${readingHtml(title, content)}\r\n--${boundary}--`;
  await request(token, `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=multipart&fields=id`, {
    method: "PATCH", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  if (!row.parents?.includes(folderId)) {
    const query = new URLSearchParams({ addParents: folderId, fields: "id" });
    if (row.parents?.length) query.set("removeParents", row.parents.join(","));
    await request(token, `${API}/${encodeURIComponent(id)}?${query}`, { method: "PATCH", body: "{}" });
  }
}
