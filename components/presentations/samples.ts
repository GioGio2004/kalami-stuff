import type { Deck } from "@/lib/presentation";

/**
 * A sample deck that uses every slide type: the dev galleries play it in each
 * theme, and it shows what a good deck reads like (one idea per slide, few
 * words, builds where suspense helps, notes for the presenter).
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */

const BROWSER_ART = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d1d1b"/><stop offset="1" stop-color="#2d2d29"/></linearGradient></defs>
<rect width="800" height="600" fill="url(#g)"/>
<rect x="90" y="90" width="620" height="420" rx="28" fill="#fafaf7"/>
<rect x="90" y="90" width="620" height="64" rx="28" fill="#eeede8"/>
<rect x="90" y="126" width="620" height="28" fill="#eeede8"/>
<circle cx="132" cy="122" r="9" fill="#ee4a2e"/><circle cx="162" cy="122" r="9" fill="#dd9a00"/><circle cx="192" cy="122" r="9" fill="#2c9e62"/>
<rect x="232" y="108" width="380" height="28" rx="14" fill="#fafaf7"/>
<rect x="140" y="196" width="300" height="34" rx="8" fill="#141414"/>
<rect x="140" y="250" width="520" height="14" rx="7" fill="#c9c8c1"/>
<rect x="140" y="276" width="470" height="14" rx="7" fill="#c9c8c1"/>
<rect x="140" y="318" width="240" height="150" rx="16" fill="#dcf35a"/>
<rect x="404" y="318" width="256" height="70" rx="16" fill="#141414"/>
<rect x="404" y="398" width="256" height="70" rx="16" fill="#e2e1da"/>
</svg>`)}`;

export const SAMPLE_DECK: Deck = {
  theme: "ink",
  slides: [
    {
      id: "s1",
      type: "title",
      kicker: "Week 1 · Web basics",
      title: "How the **web** works",
      subtitle: "From the address bar to pixels on your screen, in five moves.",
      notes: "Ask the room: what do you think happens between pressing Enter and seeing the page?",
    },
    {
      id: "s2",
      type: "statement",
      kicker: "The big idea",
      text: "Every web page is a **conversation** between two computers.",
    },
    { id: "s3", type: "section", title: "The request", kicker: "Part one" },
    {
      id: "s4",
      type: "diagram",
      title: "What happens when you press **Enter**",
      layout: "flow",
      build: true,
      nodes: [
        { label: "Browser", detail: "Your computer" },
        { label: "DNS", detail: "Finds the address", edge: "kalami.space?" },
        { label: "Server", detail: "Builds the page", edge: "GET /" },
        { label: "Pixels", detail: "Drawn on screen", edge: "200 OK" },
      ],
      notes: "Press Next for each hop. Pause on DNS: most students have never heard of it.",
    },
    {
      id: "s5",
      type: "points",
      title: "A request carries",
      build: true,
      points: ["**A method**: GET to read, POST to send", "**A path**: which page, like `/courses`", "**Headers**: who is asking, and what they accept"],
    },
    {
      id: "s6",
      type: "code",
      title: "What comes back",
      language: "html",
      code: '<!doctype html>\n<html lang="en">\n  <head>\n    <title>Kalami</title>\n  </head>\n  <body>\n    <h1>Hello, web</h1>\n    <a href="/courses">Courses</a>\n  </body>\n</html>',
      highlights: [
        { from: 3, to: 5, note: "The head: about the page, not on it." },
        { from: 6, to: 9, note: "The body: everything you see." },
        { from: 8, note: "A link starts the next conversation." },
      ],
    },
    { id: "s7", type: "section", title: "The response", kicker: "Part two" },
    {
      id: "s8",
      type: "number",
      value: 200,
      label: "means **OK**: the server found the page",
      detail: "Other codes you will meet: 301 moved, 404 not found, 500 server error.",
    },
    {
      id: "s9",
      type: "compare",
      title: "Two ways to send it",
      left: { title: "HTTP", points: ["Plain text on the wire", "Anyone on the network can read it"] },
      right: { title: "HTTPS", points: ["Encrypted end to end", "The padlock in your address bar"] },
      verdict: "Always use **HTTPS**.",
    },
    {
      id: "s10",
      type: "image",
      url: BROWSER_ART,
      alt: "A browser window with a heading, lines of text and coloured blocks",
      title: "The browser **draws** the page",
      caption: "HTML gives it structure, CSS gives it style, JavaScript gives it behaviour.",
    },
    {
      id: "s11",
      type: "diagram",
      title: "Three layers of every page",
      layout: "stack",
      nodes: [
        { label: "Content", detail: "HTML: what it says" },
        { label: "Presentation", detail: "CSS: how it looks" },
        { label: "Behaviour", detail: "JavaScript: what it does" },
      ],
    },
    {
      id: "s12",
      type: "diagram",
      title: "One page, many files",
      layout: "hub",
      nodes: [
        { label: "index.html", detail: "The page" },
        { label: "style.css", edge: "link" },
        { label: "script.js", edge: "script" },
        { label: "logo.png", edge: "img" },
        { label: "font.woff2", edge: "@font-face" },
      ],
    },
    {
      id: "s13",
      type: "diagram",
      title: "The loop of every web app",
      layout: "cycle",
      nodes: [
        { label: "Request", edge: "click" },
        { label: "Response" },
        { label: "Render" },
        { label: "Interact" },
      ],
    },
    {
      id: "s14",
      type: "quote",
      quote: "This is for everyone.",
      author: "Tim Berners-Lee",
      role: "Inventor of the World Wide Web, London 2012",
      tone: "accent",
    },
    {
      id: "s15",
      type: "closing",
      title: "Now you can **see** the web",
      points: ["A page is a conversation", "Requests ask, responses answer", "HTTPS keeps it private"],
      next: "Next week: your first HTML page",
    },
  ],
};
