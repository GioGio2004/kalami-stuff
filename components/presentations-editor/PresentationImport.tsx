"use client";

import { useState } from "react";
import { KalamiFileIcon } from "@/components/kalami/KalamiFile";
import type { PresentationFileImport, PresentationFileInspect } from "@/components/studio/types";
import { Button } from "@/components/ui/buttons";
import { FormError } from "@/components/ui/form";
import { Check } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { DEFAULT_THEME, THEME_INFO } from "@/lib/presentation";
import { DeckCover } from "./DeckCover";

type Stage =
  | { step: "pick" }
  | { step: "reading"; name: string }
  | { step: "checked" | "importing"; name: string; text: string; result: PresentationFileInspect };

/**
 * Importing a presentation file into a week: drop or choose a .kalami file,
 * see what it holds (title, theme, slides, and whether it's unchanged since
 * Kalami exported it), then import it as a new draft at the end of the week.
 * A presentation can come from another course, another lecturer, another
 * Kalami site, or an AI assistant that wrote the file. Nothing is created
 * until Import, and a file with problems lists them all.
 */
export function PresentationImport({
  weekTitle,
  onInspect,
  onImport,
  onCancel,
}: {
  weekTitle: string;
  onInspect: (text: string) => Promise<PresentationFileInspect>;
  /** Imports; on success the page opens the new presentation. */
  onImport: (text: string) => Promise<PresentationFileImport>;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ step: "pick" });
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read(file: File) {
    setError(null);
    setStage({ step: "reading", name: file.name });
    try {
      const text = await file.text();
      const result = await onInspect(text);
      setStage({ step: "checked", name: file.name, text, result });
    } catch (caught) {
      setError(errorMessage(caught));
      setStage({ step: "pick" });
    }
  }

  async function confirm() {
    if (stage.step !== "checked" || !stage.result.ok) return;
    setError(null);
    setStage({ ...stage, step: "importing" });
    try {
      const result = await onImport(stage.text);
      if (!result.ok) setStage({ ...stage, step: "checked", result });
    } catch (caught) {
      setError(errorMessage(caught));
      setStage({ ...stage, step: "checked" });
    }
  }

  return (
    <div className="p-6 sm:p-10">
      <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">A deck in a file</p>
      <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">Import a presentation</h2>

      {(stage.step === "pick" || stage.step === "reading") && (
        <>
          <p className="mt-2 text-[15px] text-graphite">
            A .kalami presentation file, from another course, another lecturer or another Kalami site. It goes into
            “{weekTitle}” as a new draft; nothing else changes.
          </p>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files[0];
              if (dropped) void read(dropped);
            }}
            className={`mt-6 flex cursor-pointer flex-col items-center gap-4 rounded-[2rem] border-2 border-dashed px-6 py-10 text-center transition ${
              dragging ? "border-ink bg-highlighter/40" : "border-ink/20 bg-panel hover:border-ink/40"
            }`}
          >
            <KalamiFileIcon className={`h-24 w-auto transition ${dragging ? "-rotate-6 scale-110" : ""}`} decorative />
            <span className="font-medium">
              {stage.step === "reading" ? `Reading ${stage.name}…` : "Drop a .kalami file here, or choose one"}
            </span>
            <span className="text-sm text-graphite">Exported with Export .kalami in a presentation&apos;s editor, or written by an AI.</span>
            <input
              type="file"
              accept=".kalami,.json,application/json"
              className="sr-only"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) void read(picked);
                e.target.value = "";
              }}
            />
            <span className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper">Choose file</span>
          </label>
          {error && (
            <div className="mt-4">
              <FormError>{error}</FormError>
            </div>
          )}
          <div className="mt-6 flex justify-end">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {(stage.step === "checked" || stage.step === "importing") && (
        <div className="mt-6">
          {stage.result.ok && <Summary name={stage.name} result={stage.result} />}
          {!stage.result.ok ? (
            <div>
              <p className="font-medium text-red-pen">This file can&apos;t be imported yet.</p>
              <p className="mt-1 text-sm text-graphite">Fix these and try again. Nothing was created.</p>
              <ul className="mt-3 max-h-64 space-y-1.5 overflow-auto rounded-2xl bg-panel p-4 font-mono text-[12.5px] leading-relaxed">
                {stage.result.errors.map((line, i) => (
                  <li key={i} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex justify-end gap-3">
                <Button variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
                <Button variant="outline" onClick={() => setStage({ step: "pick" })}>
                  Choose another file
                </Button>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="mt-4">
                  <FormError>{error}</FormError>
                </div>
              )}
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <Button variant="ghost" disabled={stage.step === "importing"} onClick={() => setStage({ step: "pick" })}>
                  Choose another file
                </Button>
                <Button variant="lime" disabled={stage.step === "importing"} onClick={() => void confirm()}>
                  {stage.step === "importing" ? "Importing…" : `Import into “${weekTitle}”`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Summary({ name, result }: { name: string; result: Extract<PresentationFileInspect, { ok: true }> }) {
  const { summary, verified } = result;
  const theme = summary.theme ?? DEFAULT_THEME;
  const at = Date.parse(verified?.at ?? summary.exported?.at ?? "");
  return (
    <div className="overflow-hidden rounded-[2rem] bg-card ring-1 ring-ink/10">
      <div className="flex items-start gap-4 p-5 sm:p-6">
        {/* The deck's cover in its theme: what students will see first. */}
        <DeckCover theme={theme} title={summary.title} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-graphite">{name}</p>
          <p className="mt-1 break-words text-2xl font-medium leading-tight tracking-tight">{summary.title}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill>
              {summary.slides} slide{summary.slides === 1 ? "" : "s"}
            </Pill>
            <Pill>{THEME_INFO[theme].label}</Pill>
            {verified ? (
              <Pill tone="lime">
                <Check className="size-3.5" />
                Verified by Kalami
              </Pill>
            ) : (
              <Pill>Not verified</Pill>
            )}
          </div>
        </div>
      </div>
      <p className="border-t border-dashed border-ink/15 px-5 py-4 text-xs leading-relaxed text-graphite sm:px-6">
        {verified
          ? `Exported from Kalami by ${verified.by}${Number.isNaN(at) ? "" : ` on ${formatDate(at)}`}, unchanged since.`
          : summary.exported
            ? `Made by ${summary.exported.from}${summary.exported.by && summary.exported.by !== summary.exported.from ? ` (${summary.exported.by})` : ""}, or edited after export. Look it through before publishing.`
            : "Made outside Kalami, or edited after export. Look it through before publishing."}
      </p>
    </div>
  );
}
