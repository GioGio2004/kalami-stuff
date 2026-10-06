import type { Scene } from "@/lib/scene";

/**
 * Starting points for a scene: what the editor's Templates menu inserts and
 * what the dev galleries show. Each one uses a different part of the
 * vocabulary, so together they're also a demo of what a scene can do.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export const SCENE_TEMPLATES: { id: string; label: string; description: string; scene: Scene }[] = [
  {
    id: "title-points",
    label: "Title and points",
    description: "A heading cascades in, then three points arrive one by one.",
    scene: {
      title: "Why the box model matters",
      elements: [
        { id: "eyebrow", kind: "text", md: "**Lesson 3 · CSS layout**", x: 90, y: 80, w: 600, h: 40, size: "sm", color: "graphite" },
        { id: "title", kind: "heading", text: "Every element is a box.", x: 90, y: 130, w: 760, h: 180, size: "xl" },
        {
          id: "points",
          kind: "list",
          items: ["Content sits in the middle", "Padding keeps the content off the edge", "The border wraps it all", "Margin pushes the neighbours away"],
          x: 90, y: 340, w: 620, h: 280, size: "lg",
        },
        { id: "box", kind: "shape", shape: "rect", fill: "highlighter", label: "content", x: 800, y: 300, w: 300, h: 180 },
        { id: "tip", kind: "note", tone: "tip", md: "Open the dev tools and hover any element: the browser colours these four layers for you.", x: 760, y: 520, w: 400, h: 110 },
      ],
      steps: [
        { note: "Start with the one sentence everything else hangs on.", actions: [{ do: "enter", targets: ["eyebrow"], effect: "fade" }, { do: "enter", targets: ["title"] }] },
        { note: "The four layers, from the inside out.", actions: [{ do: "enter", targets: ["points"], stagger: 0.35 }, { do: "enter", targets: ["box"], at: 0.4 }] },
        { note: "Where to see it yourself.", actions: [{ do: "focus", targets: ["box", "tip"] }, { do: "enter", targets: ["tip"] }, { do: "emphasize", targets: ["box"], effect: "pulse", at: 0.6 }] },
        { actions: [{ do: "focus", targets: [] }] },
      ],
    },
  },
  {
    id: "diagram",
    label: "Diagram with arrows",
    description: "Boxes appear, arrows draw themselves between them, the camera zooms on the important one.",
    scene: {
      title: "What happens when you open a page",
      theme: "ink",
      elements: [
        { id: "title", kind: "heading", text: "From address bar to pixels", x: 80, y: 60, w: 1040, h: 90, size: "lg", align: "center" },
        { id: "browser", kind: "shape", shape: "pill", fill: "paper", label: "Browser", x: 90, y: 300, w: 260, h: 110 },
        { id: "dns", kind: "shape", shape: "circle", fill: "highlighter", label: "DNS", x: 470, y: 150, w: 150, h: 150 },
        { id: "server", kind: "shape", shape: "rect", fill: "paper", label: "Web server", x: 850, y: 300, w: 260, h: 110 },
        { id: "html", kind: "shape", shape: "rect", fill: "highlighter", label: "HTML", x: 470, y: 460, w: 160, h: 80 },
        { id: "ask-dns", kind: "arrow", from: "browser", to: "dns", label: "where is kalami.space?", curve: -0.25 },
        { id: "request", kind: "arrow", from: "browser", to: "server", label: "GET /" },
        { id: "response", kind: "arrow", from: "server", to: "html", label: "200 OK", curve: 0.2 },
        { id: "render", kind: "arrow", from: "html", to: "browser", curve: 0.2 },
        { id: "aside", kind: "note", tone: "definition", md: "**DNS** turns a name into the address of a machine.", x: 680, y: 130, w: 420, h: 100 },
      ],
      steps: [
        { note: "Two machines and the phone book between them.", actions: [{ do: "enter", targets: ["title"] }, { do: "enter", targets: ["browser", "server"], stagger: 0.2 }] },
        { note: "First the browser needs an address.", actions: [{ do: "enter", targets: ["dns"] }, { do: "enter", targets: ["ask-dns"] }, { do: "camera", target: "dns", scale: 1.6, at: 0.5 }, { do: "enter", targets: ["aside"], at: 0.9 }] },
        { note: "Then it asks the server for the page.", actions: [{ do: "camera" }, { do: "exit", targets: ["aside"] }, { do: "enter", targets: ["request"], at: 0.5 }, { do: "emphasize", targets: ["server"], effect: "bounce", at: 1.2 }] },
        { note: "The server answers with HTML, and the browser draws it.", actions: [{ do: "enter", targets: ["html", "response"] }, { do: "enter", targets: ["render"], at: 0.9 }, { do: "focus", targets: ["html", "browser", "render"], at: 1.4 }] },
        { actions: [{ do: "focus", targets: [] }, { do: "emphasize", targets: ["browser", "dns", "server", "html"], effect: "pulse" }] },
      ],
    },
  },
  {
    id: "code-walkthrough",
    label: "Code walkthrough",
    description: "A snippet types itself, then notes point at the lines that matter.",
    scene: {
      title: "A CSS rule, piece by piece",
      elements: [
        { id: "title", kind: "heading", text: "Anatomy of a rule", x: 80, y: 60, w: 700, h: 80, size: "lg" },
        { id: "code", kind: "code", language: "css", code: ".card {\n  padding: 24px;\n  border-radius: 16px;\n  background: white;\n}", x: 80, y: 170, w: 560, h: 300, size: "lg" },
        { id: "selector", kind: "note", tone: "definition", md: "**Selector** — which elements the rule styles.", x: 700, y: 170, w: 420, h: 90 },
        { id: "declaration", kind: "note", tone: "definition", md: "**Declaration** — a property and its value, ended with `;`.", x: 700, y: 290, w: 420, h: 100 },
        { id: "braces", kind: "note", tone: "warning", md: "Every `{` needs its `}`. A missing one silently breaks everything after it.", x: 700, y: 420, w: 420, h: 110 },
        { id: "sel-arrow", kind: "arrow", from: "selector", to: "code", curve: -0.15 },
        { id: "count", kind: "number", value: 3, label: "declarations", x: 80, y: 500, w: 300, h: 140, size: "md", color: "graphite" },
      ],
      steps: [
        { note: "Watch a rule get written.", actions: [{ do: "enter", targets: ["title"] }, { do: "enter", targets: ["code"], at: 0.5 }] },
        { note: "Before the brace: the selector.", actions: [{ do: "enter", targets: ["selector"], effect: "slide-right" }, { do: "enter", targets: ["sel-arrow"] }] },
        { note: "Inside: one declaration per line.", actions: [{ do: "exit", targets: ["sel-arrow"] }, { do: "enter", targets: ["declaration"], effect: "slide-right" }, { do: "enter", targets: ["count"], at: 0.5 }] },
        { note: "The bit people forget.", actions: [{ do: "enter", targets: ["braces"], effect: "pop" }, { do: "emphasize", targets: ["code"], effect: "shake", at: 0.4 }] },
      ],
    },
  },
  {
    id: "before-after",
    label: "Before and after",
    description: "One thing moves aside to make room for a comparison, and the numbers count up.",
    scene: {
      title: "What a good image size saves",
      elements: [
        { id: "title", kind: "heading", text: "Resize images before you upload them", x: 80, y: 60, w: 1040, h: 80, size: "md" },
        { id: "before", kind: "shape", shape: "rect", fill: "red-pen", color: "paper", label: "Original photo", x: 380, y: 230, w: 440, h: 260 },
        { id: "after", kind: "shape", shape: "rect", fill: "ok", color: "paper", label: "Resized for the web", x: 700, y: 230, w: 400, h: 260 },
        { id: "mb", kind: "number", value: 4.8, decimals: 1, suffix: " MB", label: "before", x: 100, y: 520, w: 360, h: 130, size: "lg", color: "red-pen" },
        { id: "kb", kind: "number", value: 180, suffix: " KB", label: "after", x: 700, y: 520, w: 360, h: 130, size: "lg", color: "ok" },
        { id: "faster", kind: "text", md: "About **25×** smaller, and it looks the same on a screen.", x: 80, y: 180, w: 600, h: 60, size: "md", color: "graphite" },
      ],
      steps: [
        { note: "A photo straight from a phone.", actions: [{ do: "enter", targets: ["title"] }, { do: "enter", targets: ["before"], effect: "pop" }, { do: "enter", targets: ["mb"], at: 0.6 }] },
        { note: "Make room, then compare.", actions: [{ do: "move", target: "before", x: 100, w: 440 }, { do: "enter", targets: ["after"], effect: "slide-left", at: 0.5 }, { do: "enter", targets: ["kb"], at: 1 }] },
        { note: "The whole point in one line.", actions: [{ do: "enter", targets: ["faster"], effect: "rise" }, { do: "emphasize", targets: ["kb"], effect: "glow", at: 0.3 }] },
      ],
    },
  },
];
