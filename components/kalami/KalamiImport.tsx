"use client";

import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/buttons";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormError, SelectInput } from "@/components/ui/form";
import { Check } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import type { api } from "@/convex/_generated/api";
import { MAX_KALAMI_BYTES } from "@/convex/lib/kalami";
import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import type { UniversityOption } from "@/components/studio/types";
import { KalamiFileIcon } from "./KalamiFile";

export type InspectResult = FunctionReturnType<typeof api.kalami.inspect>;
export type ImportResult = FunctionReturnType<typeof api.kalami.importCourse>;
type Summary = NonNullable<InspectResult["summary"]>;

const NO_UNIVERSITY = "none";

type Stage =
  | { step: "pick" }
  | { step: "reading"; name: string }
  | { step: "checked"; name: string; text: string; result: InspectResult }
  | { step: "importing"; name: string; text: string; result: InspectResult & { ok: true } };

/**
 * Opening a .kalami file: pick or drop it, see what's inside (and whether
 * Kalami verified it), then import it as a new draft course. The file is read
 * in the browser and checked by the backend; nothing is created until the
 * lecturer presses Import.
 */
export function KalamiImport({
  open,
  file,
  universities,
  onClose,
  onInspect,
  onImport,
}: {
  open: boolean;
  /** A file dropped somewhere on the page, to open straight away. */
  file: File | null;
  universities: UniversityOption[] | undefined;
  onClose: () => void;
  onInspect: (text: string) => Promise<InspectResult>;
  /** Resolves once the course exists; the caller navigates to it. */
  onImport: (text: string, universityId: UniversityOption["_id"] | null | undefined) => Promise<ImportResult>;
}) {
  const [stage, setStage] = useState<Stage>({ step: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [university, setUniversity] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function read(picked: File) {
    setError(null);
    if (picked.size > MAX_KALAMI_BYTES) {
      setError("That file is larger than 4 MB, so it can't be a .kalami course file.");
      return;
    }
    setStage({ step: "reading", name: picked.name });
    try {
      const text = await picked.text();
      setStage({ step: "checked", name: picked.name, text, result: await onInspect(text) });
    } catch (caught) {
      setStage({ step: "pick" });
      setError(errorMessage(caught));
    }
  }

  // A file dropped on the page opens here directly (a tick later, outside the render).
  useEffect(() => {
    if (!open || !file) return;
    const timer = setTimeout(() => void read(file), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per dropped file
  }, [open, file]);

  function close() {
    if (stage.step === "importing") return;
    setStage({ step: "pick" });
    setError(null);
    onClose();
  }

  async function importIt() {
    if (stage.step !== "checked" || !stage.result.ok) return;
    setError(null);
    setStage({ ...stage, step: "importing", result: stage.result });
    try {
      const options = universities ?? [];
      const universityId =
        options.length === 0
          ? undefined
          : (university || options[0]._id) === NO_UNIVERSITY
            ? null
            : ((university || options[0]._id) as UniversityOption["_id"]);
      const result = await onImport(stage.text, universityId);
      if (!result.ok) {
        setStage({ step: "checked", name: stage.name, text: stage.text, result });
      }
    } catch (caught) {
      setError(errorMessage(caught));
      setStage({ step: "checked", name: stage.name, text: stage.text, result: stage.result });
    }
  }

  return (
    <Dialog open={open} onClose={close} label="Import a .kalami course file">
      <div className="p-6 sm:p-10">
        <p className="-rotate-2 font-hand text-[1.6rem] leading-none text-graphite">A course in a file</p>
        <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em]">Import .kalami</h2>

        {(stage.step === "pick" || stage.step === "reading") && (
          <>
            <p className="mt-2 text-[15px] text-graphite">
              A .kalami file holds a whole course: its weeks, lessons, links, quizzes, tasks and exams. It becomes a new
              draft course that only you see until you publish it.
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
              <KalamiFileIcon className={`h-24 w-auto transition ${dragging ? "-rotate-6 scale-110" : ""}`} />
              <span className="font-medium">
                {stage.step === "reading" ? `Reading ${stage.name}…` : "Drop a .kalami file here, or choose one"}
              </span>
              <span className="text-sm text-graphite">Exported from Kalami, or written by you or your AI assistant.</span>
              <input
                ref={input}
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
          </>
        )}

        {(stage.step === "checked" || stage.step === "importing") && (
          <div className="mt-6">
            {stage.result.summary && <SummaryCard name={stage.name} summary={stage.result.summary} verified={stage.result.ok ? stage.result.verified : null} />}
            {!stage.result.ok ? (
              <div className="mt-5">
                <p className="font-medium text-red-pen">This file can&apos;t be imported yet.</p>
                <p className="mt-1 text-sm text-graphite">Fix these and try again. Nothing was created.</p>
                <ul className="mt-3 max-h-64 space-y-1.5 overflow-auto rounded-2xl bg-panel p-4 font-mono text-[12.5px] leading-relaxed">
                  {stage.result.errors.map((line, i) => (
                    <li key={i} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex justify-end">
                  <Button variant="outline" onClick={() => setStage({ step: "pick" })}>
                    Choose another file
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {universities && universities.length > 0 && (
                  <div className="mt-5">
                    <Field label="University" htmlFor="kalami-university" hint="Fixed once the course exists.">
                      <SelectInput id="kalami-university" value={university || universities[0]._id} onChange={(e) => setUniversity(e.target.value)}>
                        {universities.map((u) => (
                          <option key={u._id} value={u._id}>
                            {u.name.en} · {u.name.ka}
                          </option>
                        ))}
                        <option value={NO_UNIVERSITY}>No university (school, private lessons)</option>
                      </SelectInput>
                    </Field>
                  </div>
                )}
                <p className="mt-5 text-sm leading-relaxed text-graphite">
                  Everything arrives as drafts: no student sees it until you publish weeks and assessments. Dates aren&apos;t
                  in files, so set opening and closing times afterwards.
                </p>
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <Button variant="ghost" onClick={() => setStage({ step: "pick" })} disabled={stage.step === "importing"}>
                    Another file
                  </Button>
                  <Button onClick={importIt} disabled={stage.step === "importing"}>
                    {stage.step === "importing" ? "Creating the course…" : "Import as a draft course"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        {error && (
          <div className="mt-4">
            <FormError>{error}</FormError>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function SummaryCard({
  name,
  summary,
  verified,
}: {
  name: string;
  summary: Summary;
  verified: { by: string; at: string } | null;
}) {
  const counts = [
    [summary.weeks, "week", "weeks"],
    [summary.lessons, "lesson", "lessons"],
    [summary.presentations, "presentation", "presentations"],
    [summary.assessments.quiz, "quiz", "quizzes"],
    [summary.assessments.task, "task", "tasks"],
    [summary.assessments.midterm + summary.assessments.final, "exam", "exams"],
    [summary.questions, "question", "questions"],
  ] as const;
  const at = Date.parse(verified?.at ?? summary.exported?.at ?? "");
  return (
    <div className="notch-sides overflow-hidden rounded-[2rem] bg-card ring-1 ring-ink/10 [--notch-y:58%]">
      <div className="flex items-start gap-4 p-5 sm:p-6">
        <KalamiFileIcon className="h-20 w-auto shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-graphite">{name}</p>
          <p className="mt-1 break-words text-2xl font-medium leading-tight tracking-tight">{summary.title}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill>{summary.language === "ka" ? "ქართული" : "English"}</Pill>
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
      <div className="border-t border-dashed border-ink/15 px-5 py-4 sm:px-6">
        <p className="text-sm text-ink/80">
          {counts
            .filter(([n]) => n > 0)
            .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
            .join(" · ") || "An empty course"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-graphite">
          {verified
            ? `Exported from Kalami by ${verified.by}${Number.isNaN(at) ? "" : ` on ${formatDate(at)}`}, unchanged since.`
            : summary.exported
              ? `Made by ${summary.exported.from}${summary.exported.by && summary.exported.by !== summary.exported.from ? ` (${summary.exported.by})` : ""}, or edited after export. Read it through before publishing.`
              : "Made outside Kalami, or edited after export. Read it through before publishing."}
        </p>
      </div>
    </div>
  );
}
