"use client";

import { createContext, useContext, useId, useState, type ClipboardEvent } from "react";
import { Button } from "@/components/ui/buttons";
import { FormError, TextInput } from "@/components/ui/form";
import { ImageIcon, LinkChain } from "@/components/ui/icons";
import { errorMessage } from "@/lib/errors";
import { isKalamiImage, sizedImage } from "@/lib/presentation";

/** A picture once Kalami has it: where it is and what it weighs (convex/model/media.ts). */
export type Picture = { url: string; width: number; height: number; bytes: number; originalBytes: number; reused: boolean };

/**
 * How the editor copies pictures into Kalami: the page wires these to Convex
 * (media.generateUploadUrl, mediaActions.upload / importLink); the dev gallery
 * fakes them. Without them (no course to put pictures in) the picker is read-only.
 */
export type PictureActions = {
  upload: (file: File, onProgress: (fraction: number) => void) => Promise<Picture>;
  importLink: (url: string) => Promise<Picture>;
};

export const PicturesContext = createContext<PictureActions | null>(null);

/** What the browser checks before sending; the server checks again (lib/media). */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml";

type Busy = { what: "upload"; progress: number } | { what: "compress" } | { what: "import" } | null;

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "another site";
  }
}

/**
 * An image slide's picture. Every picture is copied into Kalami: uploaded
 * (choose, drop or paste) or imported from a link, then compressed to WebP on
 * the server and served at the size each screen needs. A slide from before
 * that still links to another site offers to copy its picture in.
 */
export function ImagePicker({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const actions = useContext(PicturesContext);
  const linkId = useId();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [link, setLink] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [last, setLast] = useState<Picture | null>(null);

  const hasPicture = url.trim() !== "";
  const outside = hasPicture && !isKalamiImage(url);
  const showPick = !hasPicture || replacing;

  async function run(work: () => Promise<Picture>) {
    setError(null);
    try {
      const picture = await work();
      setLast(picture);
      setReplacing(false);
      setLink("");
      onChange(picture.url);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function upload(file: File) {
    if (!actions || busy) return;
    if (!file.type.startsWith("image/")) {
      setError("That file isn't a picture. Use a JPG, PNG, WebP, GIF, AVIF or SVG.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That picture is ${size(file.size)}; the most is 15 MB. Use a smaller one.`);
      return;
    }
    setBusy({ what: "upload", progress: 0 });
    void run(() =>
      actions.upload(file, (fraction) => setBusy(fraction >= 1 ? { what: "compress" } : { what: "upload", progress: fraction })),
    );
  }

  function importLink(from: string) {
    if (!actions || busy || from.trim() === "") return;
    setBusy({ what: "import" });
    void run(() => actions.importLink(from.trim()));
  }

  function onPaste(event: ClipboardEvent) {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      upload(file);
    }
  }

  const busyText =
    busy === null
      ? null
      : busy.what === "upload"
        ? `Uploading… ${Math.round(busy.progress * 100)}%`
        : busy.what === "compress"
          ? "Compressing to WebP…"
          : "Copying the picture into Kalami…";

  return (
    <div className="space-y-3" onPaste={onPaste}>
      {hasPicture && (
        <div className="overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="relative aspect-video bg-[repeating-conic-gradient(var(--color-line)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- a Kalami picture at preview size, from ImageKit */}
            <img src={sizedImage(url, 640)} alt="" className="absolute inset-0 size-full object-contain" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
            <span className="text-graphite">
              {last && last.url === url ? (
                last.reused ? (
                  "Already in this course: the same copy is used."
                ) : (
                  <>
                    <span className="font-medium text-ink">
                      {size(last.originalBytes)} → {size(last.bytes)}
                    </span>{" "}
                    · WebP, {last.width}×{last.height}
                  </>
                )
              ) : outside ? (
                <>Linked from {hostOf(url)}</>
              ) : (
                "Stored in Kalami as WebP"
              )}
            </span>
            {actions && !busy && (
              <span className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setReplacing((open) => !open)}>
                  {replacing ? "Keep this picture" : "Replace"}
                </Button>
              </span>
            )}
          </div>
        </div>
      )}

      {outside && actions && !replacing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-highlighter/30 px-4 py-3 text-sm">
          <span>
            This picture still loads from {hostOf(url)}. Copy it into Kalami so it loads fast and can&apos;t disappear.
          </span>
          <Button size="sm" disabled={busy !== null} onClick={() => importLink(url)}>
            Copy into Kalami
          </Button>
        </div>
      )}

      {showPick && actions && (
        <div className="space-y-3">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
              if (dropped) upload(dropped);
              else if (e.dataTransfer.getData("text/uri-list")) importLink(e.dataTransfer.getData("text/uri-list").split("\n")[0]);
            }}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${
              dragging ? "border-ink bg-highlighter/40" : "border-ink/20 bg-panel hover:border-ink/40"
            } ${busy ? "pointer-events-none opacity-70" : ""}`}
          >
            <ImageIcon className={`size-7 text-graphite transition ${dragging ? "scale-110 -rotate-6" : ""}`} />
            <span className="font-medium">{busyText ?? "Drop a picture here, paste one, or choose a file"}</span>
            <span className="text-xs text-graphite">JPG, PNG, WebP, GIF, AVIF or SVG, up to 15 MB. Kalami compresses it to WebP.</span>
            <input
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) upload(picked);
                e.target.value = "";
              }}
            />
            {!busy && <span className="mt-1 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper">Choose picture</span>}
          </label>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              importLink(link);
            }}
          >
            <label htmlFor={linkId} className="sr-only">
              Picture link
            </label>
            <div className="relative min-w-0 flex-1">
              <LinkChain className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-graphite" />
              <TextInput
                id={linkId}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="or paste the picture's link: https://…"
                className="pl-10"
                disabled={busy !== null}
              />
            </div>
            <Button type="submit" variant="outline" disabled={busy !== null || link.trim() === ""}>
              Import
            </Button>
          </form>
        </div>
      )}

      {!actions && !hasPicture && <p className="text-sm text-graphite">No picture yet.</p>}
      {error && <FormError>{error}</FormError>}
    </div>
  );
}
