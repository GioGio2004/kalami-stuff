import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { TAGS, type Locale } from "./dictionary";

/**
 * Tag suggestions, when the lecturer allows them: typing `<` lists the HTML
 * elements (with what each one is for, in the student's language), and
 * picking one writes the whole element with the cursor where the content
 * goes: `<h1>|</h1>`. Tab jumps on to the next blank (an attribute value, the
 * text). Only tags: no attributes or CSS, so the rest is still typed by hand.
 */

/** Elements with no closing tag. */
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "col", "wbr", "area"]);

/** Elements students reach for that the explanations don't cover yet. */
const MORE_TAGS = [
  "tfoot", "caption", "dl", "dt", "dd", "fieldset", "legend", "mark", "sub", "sup", "time", "address",
  "details", "summary", "source", "marquee", "u", "s", "q", "abbr", "cite", "picture",
];

/** Elements the sandbox removes anyway (no scripts, no frames), so they aren't offered. */
const HIDDEN = new Set(["script", "iframe"]);

/** The usual attributes come with these, as blanks to fill in. */
const TEMPLATES: Record<string, string> = {
  a: 'a href="${}">${}</a>',
  img: 'img src="${}" alt="${}">',
  link: 'link rel="stylesheet" href="${}">',
  input: 'input type="${}" name="${}">',
  label: 'label for="${}">${}</label>',
  meta: 'meta ${}>',
  source: 'source src="${}">',
  option: 'option>${}</option>',
};

function template(tag: string): string {
  if (TEMPLATES[tag]) return TEMPLATES[tag];
  return VOID.has(tag) ? `${tag}>` : `${tag}>\${}</${tag}>`;
}

function options(locale: Locale): Completion[] {
  const tags = [...new Set([...Object.keys(TAGS), ...MORE_TAGS])].filter((tag) => !HIDDEN.has(tag));
  return tags.map((tag) =>
    snippetCompletion(template(tag), {
      label: tag,
      type: "type",
      detail: VOID.has(tag) ? `<${tag}>` : `<${tag}></${tag}>`,
      info: TAGS[tag]?.[locale],
      // Headings and the everyday tags first when the list is long.
      boost: ["h1", "p", "div", "a", "img", "ul", "li"].includes(tag) ? 1 : 0,
    }),
  );
}

/** Suggests tag names right after `<`, but not in a closing tag (`</`) or a comment (`<!`). */
function tagSource(locale: () => Locale) {
  const byLocale = new Map<Locale, Completion[]>();
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/<[a-zA-Z][a-zA-Z0-9]*$|<$/);
    if (match === null) return null;
    const current = locale();
    let list = byLocale.get(current);
    if (list === undefined) {
      list = options(current);
      byLocale.set(current, list);
    }
    return { from: match.from + 1, options: list, validFor: /^[a-zA-Z0-9]*$/ };
  };
}

/** The suggestion list for HTML files; only these tags, never the language's own (attributes, CSS). */
export function tagSuggestions(locale: () => Locale): Extension {
  return autocompletion({
    override: [tagSource(locale)],
    activateOnTyping: true,
    icons: false,
    maxRenderedOptions: 30,
  });
}
