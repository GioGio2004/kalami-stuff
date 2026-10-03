"use client";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { Locale } from "./assist/dictionary";
import { explainOnHover } from "./assist/explain";
import type { Mistake } from "./assist/lint";
import type { CodeFile, IntegrityEvent, LineComment } from "./types";

/** One change inserting more than this many characters is counted (KALAMI.md §6.2). */
const LARGE_INSERT = 50;

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "14px", backgroundColor: "var(--card)", color: "var(--ink)" },
  ".cm-scroller": {
    fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.7",
  },
  ".cm-content": { padding: "14px 0", caretColor: "var(--ink)" },
  ".cm-gutters": { backgroundColor: "var(--card)", color: "var(--graphite)", border: "none", paddingLeft: "6px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--highlighter) 16%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--highlighter) 60%, transparent) !important",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--panel-strong)", outline: "none" },
  ".cm-tooltip": {
    border: "1px solid var(--line)",
    backgroundColor: "var(--card)",
    borderRadius: "14px",
    boxShadow: "0 12px 30px -12px rgba(20,20,20,0.35)",
    overflow: "hidden",
  },
  ".cm-explain": { maxWidth: "320px", padding: "10px 12px", fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "13px", lineHeight: "1.5" },
  ".cm-explain-title": { fontFamily: "var(--font-geist-mono), monospace", fontWeight: "600", marginBottom: "2px" },
  ".cm-tooltip-lint": { padding: "0" },
  ".cm-diagnostic": { padding: "8px 12px", fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "13px", maxWidth: "360px" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--red-pen)" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid var(--warn)" },
  ".cm-diagnostic-info": { borderLeft: "3px solid var(--graphite)" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--red-pen)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--warn)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-info": { backgroundImage: "none", textDecoration: "underline dotted var(--graphite)" },
  ".cm-redpen-line": { backgroundColor: "color-mix(in oklab, var(--red-pen) 9%, transparent)" },
  ".cm-redpen-note": {
    margin: "2px 12px 6px 0",
    padding: "4px 10px",
    borderLeft: "2px solid var(--red-pen)",
    color: "var(--red-pen)",
    fontFamily: "var(--font-caveat), var(--font-georgian), cursive",
    fontSize: "19px",
    lineHeight: "1.25",
    display: "flex",
    alignItems: "baseline",
    gap: "10px",
  },
  ".cm-redpen-note button": {
    marginLeft: "auto",
    fontFamily: "var(--font-geist-sans), sans-serif",
    fontSize: "12px",
    color: "var(--graphite)",
    cursor: "pointer",
  },
  ".cm-lineNumbers .cm-gutterElement": { cursor: "var(--line-cursor, default)" },
});

/**
 * Every character typed by hand: no paste, no drop, no autocomplete, no
 * auto-closing tags, and the browser's spellcheck and autocorrect switched off.
 * Blocked attempts are counted for the integrity summary.
 */
function integrityRules(report: (event: IntegrityEvent) => void): Extension {
  return [
    EditorView.domEventHandlers({
      paste: (event) => {
        event.preventDefault();
        report("pasteBlocked");
        return true;
      },
      drop: (event) => {
        event.preventDefault();
        report("dropBlocked");
        return true;
      },
      contextmenu: (event) => {
        event.preventDefault();
        return true;
      },
    }),
    // Paths that skip the DOM paste event (some mobile keyboards) still arrive as transactions.
    EditorState.transactionFilter.of((tr) => {
      if (tr.isUserEvent("input.paste")) {
        report("pasteBlocked");
        return [];
      }
      if (tr.isUserEvent("input.drop")) {
        report("dropBlocked");
        return [];
      }
      return tr;
    }),
    EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        if (!tr.docChanged || !tr.isUserEvent("input")) continue;
        let longest = 0;
        tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
          longest = Math.max(longest, inserted.length);
        });
        if (longest > LARGE_INSERT) report("largeInserts");
      }
    }),
  ];
}

// --- Red-pen notes under lines ------------------------------------------------------

class NoteWidget extends WidgetType {
  constructor(
    readonly comment: LineComment,
    readonly onDelete: ((id: string) => void) | null,
  ) {
    super();
  }
  eq(other: NoteWidget) {
    return other.comment.id === this.comment.id && other.comment.text === this.comment.text && (other.onDelete === null) === (this.onDelete === null);
  }
  toDOM() {
    const note = document.createElement("div");
    note.className = "cm-redpen-note";
    const text = document.createElement("span");
    text.textContent = this.comment.text;
    note.append(text);
    if (this.onDelete) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.onclick = () => this.onDelete?.(this.comment.id);
      note.append(remove);
    }
    return note;
  }
}

const setNotes = StateEffect.define<{ comments: LineComment[]; onDelete: ((id: string) => void) | null }>();

const notesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(notes, tr) {
    let next = notes.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setNotes)) continue;
      const doc = tr.state.doc;
      const ranges = effect.value.comments.flatMap((comment) => {
        const line = doc.line(Math.min(Math.max(1, comment.line), doc.lines));
        return [
          Decoration.line({ class: "cm-redpen-line" }).range(line.from),
          Decoration.widget({ widget: new NoteWidget(comment, effect.value.onDelete), block: true, side: 1 }).range(line.to),
        ];
      });
      next = Decoration.set(ranges, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

type Callbacks = {
  onChange: (name: string, content: string) => void;
  onIntegrity?: (event: IntegrityEvent) => void;
  onRun?: () => void;
  onSave?: () => void;
  onLineClick?: (line: number) => void;
  onDeleteComment?: (id: string) => void;
};

/**
 * CodeMirror 6 with one editor state per file, so each tab keeps its own undo
 * history. `revision` replaces every file's content from `files` (reset, load
 * solution); otherwise `files` is only read when the editor is created.
 */
export function CodeEditor({
  files,
  active,
  revision,
  readOnly,
  locked,
  locale,
  mistakes,
  comments,
  onChange,
  onIntegrity,
  onRun,
  onSave,
  onLineClick,
  onDeleteComment,
}: {
  files: CodeFile[];
  active: string;
  revision: number;
  readOnly: boolean;
  /** Student mode: the integrity rules above. Staff edit freely. */
  locked: boolean;
  locale: Locale;
  /** The mistake finder's results for the active file. */
  mistakes: Mistake[];
  /** Red-pen notes for the active file. */
  comments: LineComment[];
} & Callbacks) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const callbacks = useRef<Callbacks>({ onChange, onIntegrity, onRun, onSave, onLineClick, onDeleteComment });
  const current = useRef(active);
  const initialFiles = useRef(files);
  const localeRef = useRef(locale);
  const mistakesRef = useRef(mistakes);
  const commentsRef = useRef(comments);

  useEffect(() => {
    callbacks.current = { onChange, onIntegrity, onRun, onSave, onLineClick, onDeleteComment };
    localeRef.current = locale;
  });

  useEffect(() => {
    initialFiles.current = files;
  }, [files, revision]);

  /** Pushes the current file's mistakes and notes into the editor. */
  function decorate(editor: EditorView) {
    const doc = editor.state.doc;
    const diagnostics: Diagnostic[] = mistakesRef.current
      .filter((m) => m.to <= doc.length)
      .map((m) => ({ from: m.from, to: Math.max(m.to, m.from), severity: m.severity, message: m.message }));
    editor.dispatch(setDiagnostics(editor.state, diagnostics));
    editor.dispatch({
      effects: setNotes.of({
        comments: commentsRef.current,
        onDelete: callbacks.current.onDeleteComment ? (id) => callbacks.current.onDeleteComment?.(id) : null,
      }),
    });
  }

  // (Re)build every file's state: on mount, on `revision`, and when the mode changes.
  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const create = (name: string, doc: string) =>
      EditorState.create({
        doc,
        extensions: [
          lineNumbers({
            domEventHandlers: {
              mousedown: (editor, block) => {
                const handler = callbacks.current.onLineClick;
                if (!handler) return false;
                handler(editor.state.doc.lineAt(block.from).number);
                return true;
              },
            },
          }),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          name.endsWith(".css") ? css() : html({ autoCloseTags: false }),
          explainOnHover(() => localeRef.current),
          notesField,
          keymap.of([
            { key: "Mod-Enter", run: () => (callbacks.current.onRun?.(), true) },
            { key: "Mod-s", preventDefault: true, run: () => (callbacks.current.onSave?.(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
            translate: "no",
            "data-gramm": "false",
            "data-enable-grammarly": "false",
            "aria-label": `${name} editor`,
          }),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          locked ? integrityRules((event) => callbacks.current.onIntegrity?.(event)) : [],
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(name, update.state.doc.toString());
          }),
          theme,
        ],
      });
    states.current = new Map(initialFiles.current.map((file) => [file.name, create(file.name, file.content)]));
    const state = states.current.get(current.current) ?? states.current.values().next().value;
    if (state === undefined) return;
    if (view.current === null) {
      view.current = new EditorView({ state, parent });
    } else {
      view.current.setState(state);
    }
    decorate(view.current);
  }, [revision, readOnly, locked]);

  // Switching tabs keeps the old file's state (cursor, undo) for when it comes back.
  useEffect(() => {
    const editor = view.current;
    if (editor === null || current.current === active) return;
    states.current.set(current.current, editor.state);
    current.current = active;
    const next = states.current.get(active);
    if (next !== undefined) {
      editor.setState(next);
    }
  }, [active]);

  // New mistakes or notes (or a new tab, whose state has the old ones): redraw them.
  useEffect(() => {
    mistakesRef.current = mistakes;
    commentsRef.current = comments;
    if (view.current !== null) decorate(view.current);
  }, [mistakes, comments, active]);

  useEffect(
    () => () => {
      view.current?.destroy();
      view.current = null;
    },
    [],
  );

  return (
    <div
      ref={host}
      className="h-full min-h-0 overflow-hidden"
      style={onLineClick ? ({ "--line-cursor": "pointer" } as React.CSSProperties) : undefined}
    />
  );
}
