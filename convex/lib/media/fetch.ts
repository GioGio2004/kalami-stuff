"use node";

import { lookup } from "node:dns/promises";
import { appError } from "../errors";
import { checkImageLink, isPrivateAddress, MEDIA_LIMITS } from "./link";

// Downloads a picture from a link someone gave (a lecturer or their agent).
// Every hop is checked: the link's shape (link.ts), the addresses its name
// resolves to (nothing private, so a link can't reach into the network Kalami
// runs in), at most MEDIA_LIMITS.redirects redirects, a time limit and a size
// limit counted while the bytes arrive. Node only: imported from mediaActions.ts.

const USER_AGENT = "KalamiImageImport/1.0 (+https://kalami.space)";

async function requirePublicHost(host: string): Promise<void> {
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw appError("INVALID_INPUT", `Couldn't find the site ${host}. Check the link.`);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw appError("INVALID_INPUT", "That address isn't on the public internet.");
  }
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MEDIA_LIMITS.inputBytes) tooBig();
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MEDIA_LIMITS.inputBytes) {
      await reader.cancel().catch(() => undefined);
      tooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

function tooBig(): never {
  throw appError("INVALID_INPUT", `That picture is over ${MEDIA_LIMITS.inputBytes / 1024 / 1024} MB. Use a smaller one.`);
}

/** The picture's bytes and where they finally came from (after redirects). */
export async function fetchImage(link: string): Promise<{ bytes: Uint8Array; finalUrl: URL }> {
  let check = checkImageLink(link);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_LIMITS.fetchTimeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      if (!check.ok) throw appError("INVALID_INPUT", check.reason);
      const url = check.url;
      await requirePublicHost(url.hostname);
      let response: Response;
      try {
        response = await fetch(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": USER_AGENT, Accept: "image/webp,image/avif,image/png,image/jpeg,image/*;q=0.8" },
        });
      } catch {
        throw appError(
          "INVALID_INPUT",
          controller.signal.aborted ? "The site took too long to send the picture." : `Couldn't reach ${url.hostname}.`,
        );
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get("location");
        if (!location || hop >= MEDIA_LIMITS.redirects) {
          throw appError("INVALID_INPUT", "That link keeps redirecting. Use the picture's own address.");
        }
        check = checkImageLink(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw appError(
          "INVALID_INPUT",
          response.status === 403 || response.status === 401
            ? `${url.hostname} doesn't let other sites copy that picture. Download it and upload the file instead.`
            : `${url.hostname} answered ${response.status}: the picture isn't there.`,
        );
      }
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (type.startsWith("text/html")) {
        await response.body?.cancel().catch(() => undefined);
        throw appError(
          "INVALID_INPUT",
          "That link is a web page, not a picture. Use the picture's own address (right-click the picture → Copy image address).",
        );
      }
      return { bytes: await readCapped(response), finalUrl: url };
    }
  } finally {
    clearTimeout(timer);
  }
}
