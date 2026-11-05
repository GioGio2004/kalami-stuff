"use client";

import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { GradingDeskView, StudentWorkView, type DeskRow, type DeskView } from "@/components/studio/GradingDesk";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * The grading desk with sample students for the dev gallery (`/dev/ui?view=grading`):
 * the real student panel with a sample attempt (a code part and one answer),
 * nothing stored. Grading buttons would call Convex, so leave them be here.
 */

const NOW = Date.now();
const NO_COUNTS: DeskRow["integrity"] = { pasteBlocked: 0, dropBlocked: 0, largeInserts: 0 };

function row(i: number, student: string, status: DeskRow["status"], extra: Partial<DeskRow> = {}): DeskRow {
  return {
    attemptId: `sample_attempt_${i}` as Id<"attempts">,
    student,
    number: 1,
    status,
    autoSubmitted: false,
    startedAt: NOW - 7_200_000,
    submittedAt: status === "submitted" ? NOW - 3_600_000 + i * 60_000 : undefined,
    score: status === "submitted" ? 18 + i : undefined,
    maxScore: 30,
    graded: false,
    answered: 10,
    questionsTotal: 10,
    needsGrading: false,
    gradingError: undefined,
    integrity: NO_COUNTS,
    integrityScore: 0,
    integrityColor: "green",
    ...extra,
  };
}

export const SAMPLE_ROWS: DeskRow[] = [
  row(1, "Nino Beridze", "submitted", { graded: true, score: 27 }),
  row(2, "Giorgi Kapanadze", "submitted", { integrityColor: "yellow" }),
  row(3, "Ana Lomidze", "submitted", { needsGrading: true }),
  row(4, "Luka Tsiklauri", "submitted", { autoSubmitted: true, score: 12 }),
  row(5, "Mariam Kvaratskhelia", "in_progress"),
  row(6, "Saba Gelashvili", "submitted", { gradingError: "The page is too complex to check.", score: 0, integrityColor: "red" }),
];

type Detail = FunctionReturnType<typeof api.submissions.detail>;
const CODE_ID = "sample_code_question" as Id<"questions">;
const CHOICE_ID = "sample_choice_question" as Id<"questions">;

const SKY_CSS =
  "body { margin: 0; padding: 0 24px 40px; font-family: Verdana, sans-serif; color: #eef1ff; background-color: #0b1026; text-align: center; }\n" +
  ".star { display: inline-block; margin: 0 6px; font-size: 28px; color: #ffe27a; animation: twinkle 1.6s ease-in-out infinite alternate; }\n" +
  "#moon { width: 110px; height: 110px; margin: 20px auto; border-radius: 50%; background-color: #f6f1d5; animation: float 5s ease-in-out infinite; }\n" +
  "@keyframes twinkle { from { opacity: 0.25; } to { opacity: 1; } }\n" +
  "@keyframes float { 50% { transform: translateY(-14px); } }\n";

function sampleDetail(current: DeskRow): Detail {
  const name = current.student.split(" ")[0];
  return {
    student: current.student,
    number: current.number,
    status: current.status,
    autoSubmitted: current.autoSubmitted,
    autoScore: current.score,
    manualScore: undefined,
    maxScore: 30,
    feedback: undefined,
    gradingError: current.gradingError,
    integrity: current.integrity,
    integrityColor: current.integrityColor,
    questions: [
      {
        questionId: CODE_ID,
        prompt: "**Part 2 · HTML (10 points).** Build the web page of the **Starlight Night**, an evening of stargazing in Tbilisi.",
        points: 10,
        autoScore: 6.67,
        manualPoints: undefined,
        code: {
          files: [
            { name: "index.html", content: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <link rel="stylesheet" href="sky.css">\n</head>\n<body>\n\n</body>\n</html>\n' },
            { name: "sky.css", content: SKY_CSS },
          ],
          steps: [
            {
              title: "The header",
              instructions: "Add a `<header>` with an `<h1>` that says **Starlight Night** and three `<span class=\"star\">&#9733;</span>`.",
              checks: [
                { id: "s1c1", label: "The h1 in the header says Starlight Night", type: "text", selector: "header h1", contains: "Starlight Night" },
                { id: "s1c2", label: "The header has 3 stars", type: "count", selector: "header .star", min: 3 },
              ],
            },
            {
              title: "The moon",
              instructions: "Under the stars, add an empty `<div>` with the id `moon`.",
              checks: [{ id: "s2c1", label: "The header has a <div> with the id moon", type: "exists", selector: "header div#moon" }],
            },
          ],
          assets: [],
        },
        hiddenChecks: [],
        files: [
          {
            name: "index.html",
            content:
              '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <link rel="stylesheet" href="sky.css">\n</head>\n<body>\n  <header>\n    <h1>Starlight Night</h1>\n    <p>\n      <span class="star">&#9733;</span>\n      <span class="star">&#9733;</span>\n      <span class="star">&#9733;</span>\n    </p>\n    <div class="moon"></div>\n  </header>\n</body>\n</html>\n',
          },
          { name: "sky.css", content: SKY_CSS },
        ],
        savedAt: NOW - 3_600_000,
        checkResults: [
          { id: "s1c1", passed: true },
          { id: "s1c2", passed: true },
          { id: "s2c1", passed: false },
        ],
      },
    ],
    answers: [
      {
        questionId: CHOICE_ID,
        type: "single",
        prompt: "Which `background-attachment` value keeps the background image still while the page scrolls?",
        points: 1,
        options: [
          { id: "o1", text: "fixed" },
          { id: "o2", text: "scroll" },
        ],
        key: { type: "single", correctOptionId: "o1" },
        value: { type: "single", optionId: "o1" },
        savedAt: NOW - 3_700_000,
        autoScore: 1,
        manualPoints: undefined,
      },
    ],
    comments: [
      {
        _id: "sample_comment" as Id<"codeComments">,
        questionId: CODE_ID,
        file: "index.html",
        line: 13,
        text: `Close, ${name}: the moon needs id="moon", not a class.`,
        author: "Gio",
      },
    ],
  };
}

export function GradingDeskSample() {
  const [selected, setSelected] = useState<Id<"attempts"> | null>(null);
  const [view, setView] = useState<DeskView>("overview");
  return (
    <GradingDeskView
      title="Midterm test exam"
      kind="midterm"
      backHref="/dev/ui?view=course"
      rows={SAMPLE_ROWS}
      loading={false}
      selected={selected}
      onSelect={setSelected}
      student={(attemptId, next, previous) => {
        const current = SAMPLE_ROWS.find((r) => r.attemptId === attemptId)!;
        return (
          <StudentWorkView
            key={attemptId}
            attemptId={attemptId}
            detail={sampleDetail(current)}
            view={view}
            onView={setView}
            onNext={next}
            onPrevious={previous}
            onAddComment={async () => undefined}
            onDeleteComment={() => undefined}
          />
        );
      }}
    />
  );
}
