import type { Element } from "domhandler";
import type { Keyframes } from "./css";
import { TooMuchWork } from "./match";
import { Page, type Context } from "./page";
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
function overElements<T>(items: T[], selector: string, every: boolean, test: (item: T) => Outcome): Outcome {
  if (items.length === 0) {
    return fail(`Nothing on the page matches \`${selector}\`.`);
  }
  const outcomes = items.map(test);
  if (every) {
    return outcomes.find((o) => !o.passed) ?? pass();
  }
  return outcomes.find((o) => o.passed) ?? outcomes[0];
}

function textMatches(actual: string, expected: string, mode: "equals" | "contains", caseSensitive: boolean) {
  const a = caseSensitive ? actual : actual.toLowerCase();
  const e = (caseSensitive ? expected : expected.toLowerCase()).replace(/\s+/g, " ").trim();
  // An empty expectation (a student with no name filled into {{student.firstName}}) must not pass for free.
  if (e === "") return false;
  return mode === "equals" ? a === e : a.includes(e);
}

/** Attributes whose values browsers read in any case: `type="EMAIL"` is an email field. */
const ANY_CASE_ATTRIBUTES = new Set([
  "type", "method", "target", "rel", "dir", "autocomplete", "loading", "crossorigin", "enctype", "wrap",
  "shape", "scope", "kind", "align", "valign", "inputmode", "decoding", "referrerpolicy", "charset",
]);
/** Attributes holding a link: `./about.html` and `about.html` are the same page. */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "poster", "data", "cite", "formaction"]);

function attributeValue(attribute: string, value: string): string {
  let v = value.trim();
  if (ANY_CASE_ATTRIBUTES.has(attribute)) v = v.toLowerCase();
  if (URL_ATTRIBUTES.has(attribute)) v = v.replace(/^\.\//, "");
  return v;
}

/** Whether `property` on `element` ends up as `expected`. Shorthands compare each longhand. */
function cssMatches(page: Page, element: Element, context: Context, property: string, expected: string, viewport: number): Outcome {
  const wanted = (isShorthand(property) ? expand(property, expected) : null) ?? [{ property, value: expected }];
  for (const { property: longhand, value } of wanted) {
    const actual = page.computed(element, longhand, viewport, context);
    if (actual === null || normalizeValue(actual, longhand) !== normalizeValue(value, longhand)) {
      return fail(actual === null ? `\`${longhand}\` is not set.` : `\`${longhand}\` is \`${actual}\`.`);
    }
  }
  return pass();
}

/** Whether a @keyframes changes `property` (a shorthand counts when it sets the property). */
function animates(frames: Keyframes, property: string): boolean {
  const wanted = (isShorthand(property) ? expand(property, "initial")?.map((l) => l.property) : null) ?? [property];
  return frames.frames.some((frame) =>
    frame.declarations.some((d) => {
      const longhands = expand(d.property, d.value)?.map((l) => l.property) ?? [d.property];
      return d.property === property || wanted.some((w) => longhands.includes(w));
    }),
  );
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
    case "attr": {
      const attribute = rule.attribute.trim().toLowerCase();
      return overElements(page.select(rule.selector), rule.selector, rule.every ?? true, (element) => {
        const raw = element.attribs[attribute];
        if (raw === undefined) {
          return fail(`\`<${element.name}>\` has no \`${rule.attribute}\`.`);
        }
        const value = attributeValue(attribute, raw);
        if (rule.equals !== undefined && value !== attributeValue(attribute, rule.equals)) {
          return fail(`\`${rule.attribute}\` is “${raw}”.`);
        }
        if (rule.contains !== undefined && !value.includes(attributeValue(attribute, rule.contains))) {
          return fail(`\`${rule.attribute}\` is “${raw}”.`);
        }
        return pass();
      });
    }
    case "css": {
      const viewport = rule.viewport ?? DEFAULT_VIEWPORT;
      const property = rule.property.trim().toLowerCase();
      const expected = rule.oneOf ?? (rule.equals !== undefined ? [rule.equals] : []);
      if (expected.length === 0) {
        return fail("This check has no expected value.");
      }
      return overElements(page.selectInStates(rule.selector), rule.selector, rule.every ?? true, ({ element, context }) => {
        const outcomes = expected.map((value) => cssMatches(page, element, context, property, value, viewport));
        return outcomes.find((o) => o.passed) ?? outcomes[0];
      });
    }
    case "linked": {
      const href = rule.href.trim().replace(/^\.?\//, "");
      return page.linkedStylesheets().includes(href)
        ? pass()
        : fail(`No \`<link rel="stylesheet" href="${href}">\` in the page.`);
    }
    case "keyframes": {
      const all = page.keyframes(DEFAULT_VIEWPORT);
      const name = rule.name?.trim().toLowerCase();
      const property = rule.property?.trim().toLowerCase();
      const pool = name ? [all.get(name)].filter((k) => k !== undefined) : [...all.values()];
      if (pool.length === 0) {
        return fail(name ? `There is no \`@keyframes ${name}\`.` : "There is no `@keyframes` in the CSS.");
      }
      if (property && !pool.some((k) => animates(k, property))) {
        return fail(
          name ? `\`@keyframes ${name}\` doesn't change \`${property}\`.` : `No \`@keyframes\` changes \`${property}\`.`,
        );
      }
      return pass();
    }
    case "animation": {
      const viewport = rule.viewport ?? DEFAULT_VIEWPORT;
      const all = page.keyframes(viewport);
      const property = rule.property?.trim().toLowerCase();
      return overElements(page.selectInStates(rule.selector), rule.selector, rule.every ?? true, ({ element, context }) => {
        const names = (page.computed(element, "animation-name", viewport, context) ?? "none")
          .split(",")
          .map((n) => n.trim().replace(/^["']|["']$/g, ""))
          .filter((n) => n !== "" && n !== "none");
        if (names.length === 0) {
          return fail(`\`<${element.name}>\` has no \`animation\`.`);
        }
        const durations = (page.computed(element, "animation-duration", viewport, context) ?? "0s").split(",");
        const running = names.flatMap((name, i) => {
          const frames = all.get(name);
          const duration = normalizeValue(durations[i % durations.length] ?? "0s");
          return frames !== undefined && duration !== "0" ? [frames] : [];
        });
        if (running.length === 0) {
          const missing = names.find((n) => !all.has(n));
          return fail(
            missing !== undefined
              ? `The animation \`${missing}\` has no \`@keyframes ${missing}\`.`
              : "The animation's duration is 0, so it never plays.",
          );
        }
        if (property && !running.some((frames) => animates(frames, property))) {
          return fail(`The animation doesn't change \`${property}\`.`);
        }
        return pass();
      });
    }
  }
}

/** Runs every rule against the files. A broken rule fails on its own; it never throws. */
export function runChecks(files: CodeFile[], rules: CheckRule[]): CheckResult[] {
  const page = new Page(files);
  if (page.tooLarge !== null) {
    // Nothing is checked on a page that would take too long to check.
    return rules.map((rule) => ({ id: rule.id, passed: false, detail: page.tooLarge! }));
  }
  return rules.map((rule) => {
    try {
      return { id: rule.id, ...evaluate(page, rule) };
    } catch (error) {
      return {
        id: rule.id,
        passed: false,
        detail: error instanceof TooMuchWork ? error.message : "This check could not run. Ask your lecturer.",
      };
    }
  });
}
