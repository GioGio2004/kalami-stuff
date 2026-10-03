import type { Element } from "domhandler";
import { Page } from "./page";
import type { CheckResult, CheckRule, CodeFile } from "./types";
import { expand, isShorthand, normalizeValue } from "./values";

const DEFAULT_VIEWPORT = 1280;

type Outcome = { passed: boolean; detail: string };

const pass = (detail = "Done."): Outcome => ({ passed: true, detail });
const fail = (detail: string): Outcome => ({ passed: false, detail });

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Applies `test` to one or every element, depending on `every`. */
function overElements(
  elements: Element[],
  selector: string,
  every: boolean,
  test: (element: Element) => Outcome,
): Outcome {
  if (elements.length === 0) {
    return fail(`Nothing on the page matches \`${selector}\`.`);
  }
  const outcomes = elements.map(test);
  if (every) {
    return outcomes.find((o) => !o.passed) ?? pass();
  }
  return outcomes.find((o) => o.passed) ?? outcomes[0];
}

function textMatches(actual: string, expected: string, mode: "equals" | "contains", caseSensitive: boolean) {
  const a = caseSensitive ? actual : actual.toLowerCase();
  const e = (caseSensitive ? expected : expected.toLowerCase()).replace(/\s+/g, " ").trim();
  return mode === "equals" ? a === e : a.includes(e);
}

/** Whether `property` on `element` ends up as `expected`. Shorthands compare each longhand. */
function cssMatches(page: Page, element: Element, property: string, expected: string, viewport: number): Outcome {
  const wanted = (isShorthand(property) ? expand(property, expected) : null) ?? [{ property, value: expected }];
  for (const { property: longhand, value } of wanted) {
    const actual = page.computed(element, longhand, viewport);
    if (actual === null || normalizeValue(actual) !== normalizeValue(value)) {
      return fail(actual === null ? `\`${longhand}\` is not set.` : `\`${longhand}\` is \`${actual}\`.`);
    }
  }
  return pass();
}

function evaluate(page: Page, rule: CheckRule): Outcome {
  switch (rule.type) {
    case "exists": {
      const found = page.select(rule.selector).length;
      return found > 0 ? pass() : fail(`Nothing on the page matches \`${rule.selector}\`.`);
    }
    case "not_exists": {
      const found = page.select(rule.selector).length;
      return found === 0 ? pass() : fail(`Found ${plural(found, "match")} for \`${rule.selector}\`.`);
    }
    case "count": {
      const found = page.select(rule.selector).length;
      if (rule.min !== undefined && found < rule.min) {
        return fail(`Found ${found}, need at least ${rule.min}.`);
      }
      if (rule.max !== undefined && found > rule.max) {
        return fail(`Found ${found}, need at most ${rule.max}.`);
      }
      return pass(`Found ${found}.`);
    }
    case "text": {
      const caseSensitive = rule.caseSensitive ?? false;
      return overElements(page.select(rule.selector), rule.selector, rule.every ?? false, (element) => {
        const text = page.text(element);
        if (rule.equals !== undefined && !textMatches(text, rule.equals, "equals", caseSensitive)) {
          return fail(text === "" ? "The text is empty." : `The text is “${text.slice(0, 80)}”.`);
        }
        if (rule.contains !== undefined && !textMatches(text, rule.contains, "contains", caseSensitive)) {
          return fail(text === "" ? "The text is empty." : `The text is “${text.slice(0, 80)}”.`);
        }
        return pass();
      });
    }
    case "attr":
      return overElements(page.select(rule.selector), rule.selector, rule.every ?? true, (element) => {
        const value = element.attribs[rule.attribute.toLowerCase()];
        if (value === undefined) {
          return fail(`\`<${element.name}>\` has no \`${rule.attribute}\`.`);
        }
        if (rule.equals !== undefined && value.trim() !== rule.equals) {
          return fail(`\`${rule.attribute}\` is “${value}”.`);
        }
        if (rule.contains !== undefined && !value.includes(rule.contains)) {
          return fail(`\`${rule.attribute}\` is “${value}”.`);
        }
        return pass();
      });
    case "css": {
      const viewport = rule.viewport ?? DEFAULT_VIEWPORT;
      const property = rule.property.trim().toLowerCase();
      const expected = rule.oneOf ?? (rule.equals !== undefined ? [rule.equals] : []);
      if (expected.length === 0) {
        return fail("This check has no expected value.");
      }
      return overElements(page.select(rule.selector), rule.selector, rule.every ?? true, (element) => {
        const outcomes = expected.map((value) => cssMatches(page, element, property, value, viewport));
        return outcomes.find((o) => o.passed) ?? outcomes[0];
      });
    }
    case "linked": {
      const href = rule.href.trim().replace(/^\.\//, "");
      return page.linkedStylesheets().includes(href)
        ? pass()
        : fail(`No \`<link rel="stylesheet" href="${href}">\` in the page.`);
    }
  }
}

/** Runs every rule against the files. A broken rule fails on its own; it never throws. */
export function runChecks(files: CodeFile[], rules: CheckRule[]): CheckResult[] {
  const page = new Page(files);
  return rules.map((rule) => {
    try {
      return { id: rule.id, ...evaluate(page, rule) };
    } catch {
      return { id: rule.id, passed: false, detail: "This check could not run. Ask your lecturer." };
    }
  });
}
