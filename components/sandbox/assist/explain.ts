import { syntaxTree } from "@codemirror/language";
import { hoverTooltip, type EditorView } from "@codemirror/view";
import { ATTRIBUTES, PROPERTIES, PSEUDO, TAGS, VALUES, type Locale, type Text } from "./dictionary";

/**
 * "Explain this": rest the mouse on a tag, attribute, property or value and a
 * short card says what it is, in the student's language.
 */

type Hit = { from: number; to: number; title: string; text: Text };

function lookup(view: EditorView, pos: number, side: -1 | 1): Hit | null {
  const node = syntaxTree(view.state).resolveInner(pos, side);
  const word = view.state.sliceDoc(node.from, node.to);
  const key = word.toLowerCase();
  switch (node.name) {
    case "TagName": {
      // In CSS, a tag in a selector (`nav a`) is explained like the HTML tag.
      const text = TAGS[key];
      return text ? { from: node.from, to: node.to, title: `<${key}>`, text } : null;
    }
    case "AttributeName": {
      const text = ATTRIBUTES[key];
      return text ? { from: node.from, to: node.to, title: key, text } : null;
    }
    case "PropertyName": {
      const text = PROPERTIES[key];
      return text ? { from: node.from, to: node.to, title: key, text } : null;
    }
    case "ValueName": {
      const text = VALUES[key];
      return text ? { from: node.from, to: node.to, title: key, text } : null;
    }
    case "PseudoClassName": {
      const text = PSEUDO[key];
      return text ? { from: node.from, to: node.to, title: `:${key}`, text } : null;
    }
    default:
      return null;
  }
}

export function explainOnHover(getLocale: () => Locale) {
  return hoverTooltip(
    (view, pos, side) => {
      const hit = lookup(view, pos, side);
      if (hit === null) return null;
      return {
        pos: hit.from,
        end: hit.to,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "cm-explain";
          const title = document.createElement("p");
          title.className = "cm-explain-title";
          title.textContent = hit.title;
          const body = document.createElement("p");
          body.textContent = hit.text[getLocale()];
          dom.append(title, body);
          return { dom };
        },
      };
    },
    { hoverTime: 350 },
  );
}
