// Google Drive through the lecturer's own Google account. Lecturers sign in to
// Kalami with Clerk; connecting Drive asks Google (through Clerk) for one more
// permission, `drive.file`, which only covers files and folders Kalami itself
// created. Clerk keeps the refresh token; this file asks Clerk for a fresh
// access token per job and never stores or returns it.
//
// Deployment settings (Convex env): CLERK_SECRET_KEY (the Clerk Backend API
// key of the same Clerk app the apps use). Without it Drive work fails with a
// clear "not set up" message and everything else keeps working.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * A Drive failure in words a lecturer can act on. `retry` marks the ones worth
 * trying again by themselves (rate limits, Google having a moment).
 */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly retry = false,
    /** The file or folder is gone (deleted, or in the trash). */
    readonly missing = false,
  ) {
    super(message);
  }
}

/** No Google or Clerk call may hang a job past the point the page calls it stuck. */
const TIMEOUT_MS = 30_000;

export function driveConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

type ClerkToken = { token?: string; scopes?: string[] };

/** A fresh Google access token for this Clerk user, with the Drive permission, or a DriveError. */
export async function googleAccessToken(clerkUserId: string): Promise<string> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new DriveError("Google Drive isn't set up on this Kalami server yet.");
  }
  const response = await fetch(
    `https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}/oauth_access_tokens/oauth_google`,
    { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
  ).catch(() => {
    throw new DriveError("Couldn't reach the sign-in service. Try again in a minute.", true);
  });
  if (response.status >= 500) {
    throw new DriveError("Couldn't reach the sign-in service. Try again in a minute.", true);
  }
  if (!response.ok) {
    throw new DriveError("Connect Google Drive first.");
  }
  const body = (await response.json()) as ClerkToken[] | { data?: ClerkToken[] };
  const tokens = Array.isArray(body) ? body : (body.data ?? []);
  const withDrive = tokens.find((t) => t.token && (t.scopes ?? []).includes(DRIVE_SCOPE));
  if (withDrive?.token) {
    return withDrive.token;
  }
  throw new DriveError(
    tokens.length === 0
      ? "Connect Google Drive first: your Kalami account has no Google account attached."
      : "Connect Google Drive first: Kalami doesn't have permission to create folders in your Drive yet.",
  );
}

/** Google's error reasons, turned into what the lecturer should do. */
async function failure(response: Response): Promise<DriveError> {
  let reason = "";
  let message = "";
  try {
    const body = (await response.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = body.error?.errors?.[0]?.reason ?? "";
    message = body.error?.message ?? "";
  } catch {
    // Not JSON; the status says enough.
  }
  if (response.status === 401) {
    return new DriveError("Your Google connection expired. Connect Google Drive again.");
  }
  if (response.status === 404) {
    return new DriveError("The folder is gone from Google Drive (deleted or in the trash). Restore it, or remove this week.", false, true);
  }
  if (response.status === 429 || /rateLimitExceeded|userRateLimitExceeded|sharingRateLimitExceeded|backendError/.test(reason)) {
    return new DriveError("Google Drive is busy. Kalami will try again shortly.", true);
  }
  if (response.status >= 500) {
    return new DriveError("Google Drive had a problem. Kalami will try again shortly.", true);
  }
  if (response.status === 403 && /publishOutNotPermitted|domainPolicy|teamDrive|cannotShare/i.test(reason + message)) {
    return new DriveError(
      "Your Google account's organisation doesn't allow sharing by link. Ask its admin, or connect a personal Gmail account.",
    );
  }
  if (response.status === 403 && /storageQuotaExceeded|quota/i.test(reason)) {
    return new DriveError("Your Google Drive is full. Free up space, then try again.");
  }
  if (response.status === 403 && /insufficient/i.test(reason + message)) {
    return new DriveError(
      "Kalami can't reach this folder. It only manages folders it created; connect the Google account that owns it.",
    );
  }
  return new DriveError(`Google Drive refused the request${message ? `: ${message}` : "."}`);
}

async function drive(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${DRIVE_API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    throw new DriveError("Couldn't reach Google Drive. Kalami will try again shortly.", true);
  }
  return response;
}

/**
 * The folder Kalami made earlier for `key`, found by the tag it carries, so a
 * retried job never makes a second one. (drive.file lets Kalami search only its own files.)
 */
export async function findFolder(token: string, key: string): Promise<string | null> {
  const q = `appProperties has { key='kalami' and value='${key.replace(/[^A-Za-z0-9_-]/g, "")}' } and trashed = false`;
  const response = await drive(token, `/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&spaces=drive`);
  if (!response.ok) {
    throw await failure(response);
  }
  const body = (await response.json()) as { files?: { id: string }[] };
  return body.files?.[0]?.id ?? null;
}

/** A folder tagged with `key`, inside `parentId` (or at the top of My Drive). Reuses an existing one. */
export async function ensureFolder(token: string, key: string, name: string, parentId?: string): Promise<string> {
  const existing = await findFolder(token, key);
  if (existing !== null) {
    return existing;
  }
  const response = await drive(token, "/files?fields=id", {
    method: "POST",
    body: JSON.stringify({
      name: name.slice(0, 200),
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : undefined,
      appProperties: { kalami: key },
    }),
  });
  if (!response.ok) {
    throw await failure(response);
  }
  return ((await response.json()) as { id: string }).id;
}

/** Fails with a DriveError when the folder was deleted or trashed in Drive. */
export async function requireFolder(token: string, folderId: string): Promise<void> {
  const response = await drive(token, `/files/${encodeURIComponent(folderId)}?fields=id,trashed`);
  if (!response.ok) {
    throw await failure(response);
  }
  if (((await response.json()) as { trashed?: boolean }).trashed) {
    throw new DriveError("The folder is in your Google Drive trash. Restore it, then try again.", false, true);
  }
}

/** "Anyone with the link can view", without listing it in search. Returns the permission id. */
export async function shareByLink(token: string, folderId: string): Promise<string> {
  const response = await drive(token, `/files/${encodeURIComponent(folderId)}/permissions?fields=id`, {
    method: "POST",
    body: JSON.stringify({ type: "anyone", role: "reader", allowFileDiscovery: false }),
  });
  if (!response.ok) {
    throw await failure(response);
  }
  return ((await response.json()) as { id: string }).id;
}

/** Takes the link sharing back off. Already gone counts as done. */
export async function unshareByLink(token: string, folderId: string, permissionId: string): Promise<void> {
  const response = await drive(
    token,
    `/files/${encodeURIComponent(folderId)}/permissions/${encodeURIComponent(permissionId)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404) {
    throw await failure(response);
  }
}

export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}
