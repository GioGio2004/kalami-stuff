import { compile } from "css-select";
import { parse as parseSelector, SelectorType, type Selector } from "css-what";
import { isTag, type AnyNode, type Element } from "domhandler";

/**
 * Selector matching for the checks. css-select matches a whole selector from
 * right to left with no memory, so `a ~ p ~ p ~ p` on a long list costs
 * n × n × n… and one student's page could stall a save. Here each compound
 * (`p.card:first-child`) is still tested by css-select, but the combinators
 * between them are walked with remembered answers, so every selector costs
 * about (elements × compounds) at worst.
 *
 * States a page at rest never has (`:hover`, `:focus`…) and pseudo-elements
 * (`::before`) are taken out of the compound and kept aside: at rest such a
 * selector matches nothing, and a check can ask "what if this were hovered?".
 */

/** User-action states. Any element can be in them; a page at rest has none. */
export const STATES = new Set(["hover", "active", "focus", "focus-visible", "focus-within", "visited", "target"]);

/** Pseudo-elements, including the old one-colon spellings. */
const PSEUDO_ELEMENTS = new Set([
  "before", "after", "first-line", "first-letter", "marker", "placeholder", "selection", "backdrop",
  "file-selector-button",
]);

export type Combinator = "descendant" | "child" | "adjacent" | "sibling";

type Compound = {
  /** Null when the compound is only `*` or states. */
  test: ((element: Element) => boolean) | null;
  states: string[];
};

export type CompiledSelector = {
  /** Left to right; the last one is the subject. */
  compounds: Compound[];
  /** `combinators[i]` joins compounds[i] and compounds[i + 1]. */
  combinators: Combinator[];
  /** On the subject, e.g. "before". */
  pseudoElement: string | null;
  /** Some compound needs a state, or there is a pseudo-element: never matches a page at rest. */
  conditional: boolean;
  /** The subject's id, class or tag, to start from the few elements that could match. */
  key: { kind: "id" | "class" | "tag"; value: string } | null;
  tokens: Selector[];
};

const COMBINATORS: Partial<Record<string, Combinator>> = {
  [SelectorType.Descendant]: "descendant",
  [SelectorType.Child]: "child",
  [SelectorType.Adjacent]: "adjacent",
  [SelectorType.Sibling]: "sibling",
};

const TRAVERSALS = new Set<string>([
  SelectorType.Adjacent,
  SelectorType.Child,
  SelectorType.Descendant,
  SelectorType.Parent,
  SelectorType.Sibling,
  SelectorType.ColumnCombinator,
]);

/**
 * Parses a selector list the way a browser does. css-what also accepts
 * relative selectors like `> li` or `nav >`, which browsers reject.
 */
export function parseStrict(selector: string): Selector[][] {
  const parsed = parseSelector(selector);
  if (parsed.length === 0) {
    throw new Error("The selector is empty.");
  }
  for (const tokens of parsed) {
    if (tokens.length === 0 || TRAVERSALS.has(tokens[0].type) || TRAVERSALS.has(tokens[tokens.length - 1].type)) {
      throw new Error(`\`${selector}\` starts or ends with a combinator.`);
    }
  }
  return parsed;
}

function isPseudoElement(token: Selector): boolean {
  return (
    token.type === SelectorType.PseudoElement ||
    (token.type === SelectorType.Pseudo && token.data === null && PSEUDO_ELEMENTS.has(token.name))
  );
}

function compileCompound(tokens: Selector[], quirks: boolean, last: boolean, out: { pseudoElement: string | null }): Compound {
  const states: string[] = [];
  const rest: Selector[] = [];
  for (const token of tokens) {
    if (token.type === SelectorType.Pseudo && token.data === null && STATES.has(token.name)) {
      states.push(token.name);
    } else if (isPseudoElement(token)) {
      const name = (token as { name: string }).name;
      if (!last || out.pseudoElement !== null) {
        throw new Error(`\`::${name}\` can only come at the end of a selector.`);
      }
      out.pseudoElement = name;
    } else if (token.type !== SelectorType.Universal) {
      rest.push(token);
    }
  }
  // css-select sorts the tokens it is given, so it gets a copy (plain data, so JSON copies it).
  const copy = JSON.parse(JSON.stringify(rest)) as Selector[];
  const test = rest.length === 0 ? null : compile<AnyNode, Element>([copy], { quirksMode: quirks });
  return { test: test as ((element: Element) => boolean) | null, states };
}

function keyOf(tokens: Selector[], quirks: boolean): CompiledSelector["key"] {
  // In quirks mode ids and classes match in any case, so the exact-case index can't be used.
  if (!quirks) {
    for (const t of tokens) {
      if (t.type === SelectorType.Attribute && t.name === "id" && t.action === "equals" && !t.ignoreCase) {
        return { kind: "id", value: t.value };
      }
    }
    for (const t of tokens) {
      if (t.type === SelectorType.Attribute && t.name === "class" && t.action === "element" && t.ignoreCase !== true) {
        return { kind: "class", value: t.value };
      }
    }
  }
  for (const t of tokens) {
    if (t.type === SelectorType.Tag) return { kind: "tag", value: t.name.toLowerCase() };
  }
  return null;
}

function compileOne(tokens: Selector[], quirks: boolean): CompiledSelector {
  const groups: Selector[][] = [[]];
  const combinators: Combinator[] = [];
  for (const token of tokens) {
    if (TRAVERSALS.has(token.type)) {
      const combinator = COMBINATORS[token.type];
      if (combinator === undefined) {
        throw new Error("Browsers don't support this combinator.");
      }
      combinators.push(combinator);
      groups.push([]);
    } else {
      groups[groups.length - 1].push(token);
    }
  }
  const out = { pseudoElement: null as string | null };
  const compounds = groups.map((group, i) => compileCompound(group, quirks, i === groups.length - 1, out));
  return {
    compounds,
    combinators,
    pseudoElement: out.pseudoElement,
    conditional: out.pseudoElement !== null || compounds.some((c) => c.states.length > 0),
    key: keyOf(groups[groups.length - 1], quirks),
    tokens,
  };
}

const cache = new Map<string, CompiledSelector[] | Error>();
const CACHE_LIMIT = 4000;

/**
 * A selector list, compiled. Throws when a browser would reject any part of
 * it (one bad selector in a list drops the whole rule in CSS).
 */
export function compileSelector(selector: string, quirks = false): CompiledSelector[] {
  const key = `${quirks ? "q" : "s"}${selector}`;
  let entry = cache.get(key);
  if (entry === undefined) {
    try {
      entry = parseStrict(selector).map((tokens) => compileOne(tokens, quirks));
    } catch (error) {
      entry = error instanceof Error ? error : new Error("The selector is not valid.");
    }
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, entry);
  }
  if (entry instanceof Error) throw entry;
  return entry;
}

/** Thrown when a page needs more selector work than checks are allowed to spend. */
export class TooMuchWork extends Error {
  constructor() {
    super("The page and its CSS are too complex to check.");
  }
}

export function parentOf(element: Element): Element | null {
  const parent = element.parent;
  return parent !== null && isTag(parent as AnyNode) ? (parent as Element) : null;
}

export function previousElement(element: Element): Element | null {
  let node = element.prev;
  while (node !== null && !isTag(node as AnyNode)) node = node.prev;
  return node as Element | null;
}

/** Which elements are in which state, for "what if it were hovered?" questions. */
export type States = Map<Element, Set<string>>;

type Memo = {
  at: Map<Element, boolean>[];
  /** "this element or one of its ancestors matches compound i". */
  up: Map<Element, boolean>[];
  /** "this element or one of its earlier siblings matches compound i". */
  back: Map<Element, boolean>[];
};

function newMemo(size: number): Memo {
  const maps = () => Array.from({ length: size }, () => new Map<Element, boolean>());
  return { at: maps(), up: maps(), back: maps() };
}

/**
 * Matches compiled selectors against elements, remembering every answer for
 * the page at rest. `limit` caps the compound tests one page may cost; past
 * it, `TooMuchWork` is thrown. The cap counts work, not time, so the
 * student's browser and the server always agree.
 */
export class Matcher {
  work = 0;
  private readonly memos = new Map<CompiledSelector, Memo>();

  constructor(private readonly limit: number) {}

  /** Whether `element` matches at rest: no states, no pseudo-elements. */
  matches(selector: CompiledSelector, element: Element): boolean {
    if (selector.conditional) return false;
    let memo = this.memos.get(selector);
    if (memo === undefined) {
      memo = newMemo(selector.compounds.length);
      this.memos.set(selector, memo);
    }
    return this.at(selector, selector.compounds.length - 1, element, memo, null);
  }

  /** Whether `element` matches with some elements in states (hovered, focused…). */
  matchesIn(selector: CompiledSelector, element: Element, states: States): boolean {
    return this.at(selector, selector.compounds.length - 1, element, newMemo(selector.compounds.length), states);
  }

  /**
   * For a check like `.card:hover .title`: whether `element` could match if
   * the right elements were in the right states, and which states those are.
   */
  assume(selector: CompiledSelector, element: Element): States | null {
    const path: Element[] = [];
    if (!this.find(selector, selector.compounds.length - 1, element, path)) return null;
    const states: States = new Map();
    selector.compounds.forEach((compound, i) => {
      for (const state of compound.states) addState(states, path[i], state);
    });
    return states;
  }

  private tick() {
    if (++this.work > this.limit) throw new TooMuchWork();
  }

  private compoundOk(compound: Compound, element: Element, states: States | null): boolean {
    this.tick();
    if (compound.states.length > 0) {
      const has = states?.get(element);
      if (has === undefined || !compound.states.every((s) => has.has(s))) return false;
    }
    return compound.test === null || compound.test(element);
  }

  private at(selector: CompiledSelector, i: number, element: Element, memo: Memo, states: States | null): boolean {
    const known = memo.at[i].get(element);
    if (known !== undefined) return known;
    let result = this.compoundOk(selector.compounds[i], element, states);
    if (result && i > 0) {
      switch (selector.combinators[i - 1]) {
        case "child": {
          const parent = parentOf(element);
          result = parent !== null && this.at(selector, i - 1, parent, memo, states);
          break;
        }
        case "descendant": {
          const parent = parentOf(element);
          result = parent !== null && this.walk(selector, i - 1, parent, memo, states, memo.up[i - 1], parentOf);
          break;
        }
        case "adjacent": {
          const previous = previousElement(element);
          result = previous !== null && this.at(selector, i - 1, previous, memo, states);
          break;
        }
        case "sibling": {
          const previous = previousElement(element);
          result = previous !== null && this.walk(selector, i - 1, previous, memo, states, memo.back[i - 1], previousElement);
          break;
        }
      }
    }
    memo.at[i].set(element, result);
    return result;
  }

  /** Whether `start` or anything reached from it by `next` matches compound i. Iterative, remembered. */
  private walk(
    selector: CompiledSelector,
    i: number,
    start: Element,
    memo: Memo,
    states: States | null,
    seen: Map<Element, boolean>,
    next: (element: Element) => Element | null,
  ): boolean {
    const chain: Element[] = [];
    let node: Element | null = start;
    let result = false;
    while (node !== null) {
      const known = seen.get(node);
      if (known !== undefined) {
        result = known;
        break;
      }
      if (this.at(selector, i, node, memo, states)) {
        result = true;
        seen.set(node, true);
        break;
      }
      chain.push(node);
      node = next(node);
    }
    // Everything walked past leads to the same answer.
    for (const element of chain) seen.set(element, result);
    return result;
  }

  /** Backtracking search for one way `element` matches, states assumed true. */
  private find(selector: CompiledSelector, i: number, element: Element, path: Element[]): boolean {
    const compound = selector.compounds[i];
    this.tick();
    if (compound.test !== null && !compound.test(element)) return false;
    path[i] = element;
    if (i === 0) return true;
    const candidates: Element[] = [];
    switch (selector.combinators[i - 1]) {
      case "child":
      case "descendant": {
        let node = parentOf(element);
        while (node !== null) {
          candidates.push(node);
          if (selector.combinators[i - 1] === "child") break;
          node = parentOf(node);
        }
        break;
      }
      case "adjacent":
      case "sibling": {
        let node = previousElement(element);
        while (node !== null) {
          candidates.push(node);
          if (selector.combinators[i - 1] === "adjacent") break;
          node = previousElement(node);
        }
        break;
      }
    }
    return candidates.some((candidate) => this.find(selector, i - 1, candidate, path));
  }
}

/**
 * Puts `element` in `state`, with what follows from it: hovering or pressing
 * an element hovers or presses its ancestors too, and focus is felt by every
 * ancestor's `:focus-within`.
 */
export function addState(states: States, element: Element, state: string) {
  const put = (el: Element, s: string) => {
    let set = states.get(el);
    if (set === undefined) states.set(el, (set = new Set()));
    set.add(s);
  };
  put(element, state);
  if (state === "focus" || state === "focus-visible") {
    put(element, "focus");
    for (let el: Element | null = element; el !== null; el = parentOf(el)) put(el, "focus-within");
  } else if (state === "hover" || state === "active" || state === "focus-within") {
    for (let el = parentOf(element); el !== null; el = parentOf(el)) put(el, state);
  }
}
