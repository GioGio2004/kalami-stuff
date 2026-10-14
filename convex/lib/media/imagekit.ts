import { appError } from "../errors";

// Kalami's ImageKit account, server to server: the private key never leaves
// Convex (set IMAGEKIT_API_PRIVATE_KEY on each deployment; IMAGEKIT_FOLDER
// keeps dev and prod apart in one account). Plain REST, no SDK.

const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";
const FILES_URL = "https://api.imagekit.io/v1/files";

export function imageKitConfigured(): boolean {
  return Boolean(process.env.IMAGEKIT_API_PRIVATE_KEY);
}

function authHeader(): string {
  const key = process.env.IMAGEKIT_API_PRIVATE_KEY;
  if (!key) {
    throw appError("CONFLICT", "Pictures aren't set up on this Kalami yet (IMAGEKIT_API_PRIVATE_KEY is missing).");
  }
  // HTTP Basic with the private key as the user name and no password.
  return `Basic ${btoa(`${key}:`)}`;
}

/** The folder a course's pictures go in: `<IMAGEKIT_FOLDER>/courses/<courseId>`. */
export function courseFolder(courseId: string): string {
  const root = (process.env.IMAGEKIT_FOLDER ?? "/kalami").replace(/\/+$/, "");
  return `${root.startsWith("/") ? root : `/${root}`}/courses/${courseId}`;
}

export type StoredFile = { fileId: string; url: string };

export async function uploadToImageKit(args: { data: Uint8Array; fileName: string; folder: string; tags: string[] }): Promise<StoredFile> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(args.data)], { type: "image/webp" }), args.fileName);
  form.append("fileName", args.fileName);
  form.append("folder", args.folder);
  form.append("useUniqueFileName", "true");
  form.append("tags", args.tags.join(","));
  let response: Response;
  try {
    response = await fetch(UPLOAD_URL, { method: "POST", headers: { Authorization: authHeader() }, body: form });
  } catch {
    throw appError("CONFLICT", "Couldn't reach the picture store. Try again in a moment.");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`ImageKit upload failed: ${response.status} ${detail.slice(0, 300)}`);
    throw appError(
      response.status === 429 ? "RATE_LIMITED" : "CONFLICT",
      response.status === 429 ? "The picture store is busy. Try again in a minute." : "The picture store refused the picture. Try again in a moment.",
    );
  }
  const body = (await response.json()) as { fileId?: unknown; url?: unknown };
  if (typeof body.fileId !== "string" || typeof body.url !== "string") {
    throw appError("CONFLICT", "The picture store gave an unexpected answer. Try again in a moment.");
  }
  return { fileId: body.fileId, url: body.url };
}

/** Deletes a stored picture; one that is already gone counts as deleted. */
export async function deleteFromImageKit(fileId: string): Promise<void> {
  const response = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: authHeader() },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`ImageKit delete ${fileId} failed: ${response.status}`);
  }
}
