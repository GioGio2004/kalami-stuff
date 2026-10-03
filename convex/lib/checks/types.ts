/**
 * The automatic checks on a student's HTML/CSS. One engine runs in three places:
 * the student's browser (instant ticks), Convex (the grade, on submit) and the
 * studio (testing a task against its solution). The same code everywhere means
 * the browser and the server never disagree.
 *
 * Source of truth: kalami-stuff/convex/lib/checks. The student app keeps a copy
 * in lib/checks (`npm run sync:student` in kalami-stuff refreshes it).
 */

export type CodeFile = { name: string; content: string };

type RuleBase = {
  id: string;
  /** What the student reads, e.g. "Your page has a <nav>". */
  label: string;
};

export type CheckRule = RuleBase &
  (
    | { type: "exists"; selector: string }
    | { type: "not_exists"; selector: string }
    | { type: "count"; selector: string; min?: number; max?: number }
    | {
        type: "text";
        selector: string;
        equals?: string;
        contains?: string;
        caseSensitive?: boolean;
        /** Default false: one matching element is enough. */
        every?: boolean;
      }
    | {
        type: "attr";
        selector: string;
        attribute: string;
        equals?: string;
        contains?: string;
        /** Default true: every matching element must pass. */
        every?: boolean;
      }
    | {
        type: "css";
        selector: string;
        property: string;
        equals?: string;
        oneOf?: readonly string[];
        /** Default true: every matching element must pass. */
        every?: boolean;
        /** Viewport width in px for media queries. Default 1280. */
        viewport?: number;
      }
    | { type: "linked"; href: string }
  );

export type CheckType = CheckRule["type"];

export type CheckResult = {
  id: string;
  passed: boolean;
  /** Short reason, e.g. "Found 2, need at least 3." Safe to show for visible checks. */
  detail: string;
};
