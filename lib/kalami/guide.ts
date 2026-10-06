/**
 * The .kalami authoring guide: for lecturers, developers and AI assistants
 * writing course files by hand. Served as Markdown at /kalami-format and by
 * the MCP tool get_kalami_format; the machine-readable twin is the JSON Schema
 * at /kalami.schema.json (from convex/lib/kalami.ts). Keep the three in step.
 *
 * Written as a plain template literal: backticks are escaped as \`, and the
 * "\\n" inside JSON examples is written \\n so the guide shows it literally.
 */
export const KALAMI_GUIDE = `# The .kalami course file, version 1

A \`.kalami\` file is a whole Kalami course in one UTF-8 JSON file: its outline
of weeks, the lessons written in each week, the week's links, its tasks and
quizzes, and the course's midterms and finals. Kalami exports one with
**Export .kalami** on a course page; a lecturer imports one with **Import
.kalami** (it always becomes a new **draft** course that nobody else sees until
it's published).

You can also write one yourself, or an AI assistant can, for example to turn a
syllabus into a course in one go. This guide is everything you need.

JSON Schema: https://staff.kalami.space/kalami.schema.json

## What a file never contains

No students, attempts, grades, groups, join codes, Drive permissions, ids or
dates. Opening and closing times are set by the lecturer after import.

## The shape

~~~json
{
  "$schema": "https://staff.kalami.space/kalami.schema.json",
  "format": "kalami",
  "version": 1,
  "kind": "course",
  "exported": { "by": "Claude", "at": "2026-10-04T20:00:00Z", "from": "Claude" },
  "course": {
    "title": "Web basics",
    "description": "HTML and CSS from zero to a finished page.",
    "semester": "Spring 2027",
    "language": "en",
    "weeks": [],
    "exams": [],
    "other": []
  }
}
~~~

- \`format\` is always \`"kalami"\`, \`version\` always \`1\`, \`kind\` always \`"course"\`.
- \`exported\` is optional. Set \`from\` to your own name when you write a file.
- **Never write \`signature\`.** Kalami signs the files it exports; an unchanged
  exported file shows "Verified by Kalami" on import. Files you write simply
  aren't verified, which is fine.
- \`language\`: \`"ka"\` (Georgian) or \`"en"\` (English): the language the content is
  written in. Write everything in that language.

## course

| Field | Required | Notes |
|---|---|---|
| \`title\` | yes | up to 120 characters |
| \`description\` | no | up to 2000 |
| \`semester\` | no | e.g. "Spring 2027" |
| \`language\` | yes | \`"ka"\` or \`"en"\` |
| \`weeks\` | no | up to 60, in order |
| \`exams\` | no | midterms and finals only |
| \`other\` | no | tasks and quizzes that belong to no week |

## A week

~~~json
{
  "title": "Week 2 · Styling with CSS",
  "description": "Selectors, colours and the box model.",
  "lessons": [ { "title": "Choosing elements", "blocks": [] } ],
  "links": [ { "title": "MDN: CSS basics", "url": "https://developer.mozilla.org/en-US/docs/Learn/CSS" } ],
  "assessments": [ { "kind": "quiz", "title": "Selectors quiz", "questions": [] } ]
}
~~~

- \`title\`: "Week 2", or any title ("Unit 2 · Forms"). Up to 120 characters.
- \`lessons\`: up to 30, in order. Each has a \`title\` (up to 160) and \`blocks\`.
- \`presentations\`: up to 20 decks of slides; see **Presentations**.
- \`links\`: up to 20; \`url\` must start with \`https://\`.
- \`assessments\`: the week's **tasks and quizzes** only (\`kind\` \`"task"\` or \`"quiz"\`).
- \`driveFolder\` may appear in exported files; it's informational and ignored on import.

## Lessons: blocks

A lesson is a list of blocks, shown top to bottom. Text is Markdown:
paragraphs, \`**bold**\`, \`*italic*\`, inline \`code\` in backticks,
\`[links](https://…)\`, \`-\` and \`1.\` lists, \`###\` headings. No HTML.

| type | fields | use it for |
|---|---|---|
| \`text\` | \`md\` (up to 20 000) | explanation, one idea per block |
| \`callout\` | \`tone\` (\`tip\` / \`definition\` / \`warning\` / \`note\`), \`title?\`, \`md\` | a key term (definition, title = the term), practical advice (tip), a common mistake (warning) |
| \`code\` | \`language\`, \`code\`, \`caption?\`, \`preview?\` | every example. \`preview: true\` (html and css only) shows the rendered result next to the code |
| \`image\` | \`url\` (https), \`alt\` (required), \`caption?\` | diagrams, screenshots. \`alt\` describes the image for screen readers |
| \`video\` | \`url\`, \`caption?\` | YouTube and Vimeo play inside the lesson; other links show as a link |
| \`steps\` | \`title?\`, \`steps\`: [{ \`title?\`, \`md\` }] (1 to 20) | procedures; students reveal one step at a time |
| \`check\` | \`check\`: { \`kind\`, \`prompt\`, \`options?\`, \`accepted?\`, \`explanation?\` } | a quick, ungraded self-check |
| \`scene\` | \`scene\`: { \`title?\`, \`theme?\`, \`elements\`, \`steps\` } | an animated scene students click through; see **Lessons: animated scenes** |

\`code.language\` is one of: html, css, javascript, typescript, python, java, c,
cpp, csharp, php, sql, json, bash, text.

\`check\`: \`kind\` \`"single"\` needs \`options\` with exactly one \`"correct": true\`;
\`"multiple"\` at least one; \`"short"\` needs \`accepted\` (1 to 20 answers, compared
ignoring case and extra spaces). Always add an \`explanation\`.

~~~json
[
  { "type": "text", "md": "A **selector** picks the elements a rule styles." },
  { "type": "callout", "tone": "definition", "title": "Selector", "md": "Everything before the { of a CSS rule." },
  { "type": "code", "language": "css", "code": "p {\\n  color: teal;\\n}", "preview": true },
  { "type": "steps", "title": "Write a rule", "steps": [
    { "md": "Write the selector: \`p\`." },
    { "md": "Open {, add \`color: teal;\`, close }." }
  ] },
  { "type": "check", "check": {
    "kind": "single",
    "prompt": "Which selector styles every paragraph?",
    "options": [ { "text": "p", "correct": true }, { "text": ".p", "correct": false } ],
    "explanation": "A bare tag name selects every element of that type."
  } }
]
~~~

Up to 150 blocks per lesson. A good lesson covers one topic in roughly 5 to 25
blocks (10 to 20 minutes of reading), with a \`check\` every few blocks.

## Lessons: animated scenes

A \`scene\` block is one custom animation inside a lesson (for whole decks,
see **Presentations**): elements
placed on a stage of **1200 × 675** units (x to the right, y down, from the
top-left corner; the stage scales to the screen), and **steps** a student clicks
through, each running a few named animations. Nothing in a scene is code, so
write freely: Kalami checks every id, position and effect before accepting it.

\`{ "type": "scene", "scene": { "title?", "theme?": "paper" | "ink", "elements": [...], "steps": [...] } }\`

Elements (up to 24; every \`id\` is lowercase, unique, like \`"title"\` or \`"box-2"\`;
\`x\`, \`y\` are required, \`w\`, \`h\` optional with a sensible default per kind):

| kind | fields | notes |
|---|---|---|
| \`heading\` | \`text\`, \`size?\` (sm/md/lg/xl), \`align?\`, \`color?\` | one line, cascades in letter by letter |
| \`text\` | \`md\`, \`size?\`, \`align?\`, \`color?\` | a short paragraph |
| \`list\` | \`items\` (1 to 12, Markdown), \`ordered?\`, \`size?\`, \`color?\` | items arrive one after another |
| \`code\` | \`language\`, \`code\` (up to 24 lines), \`size?\` | types itself line by line |
| \`image\` | \`url\` (https), \`alt\`, \`fit?\` (cover/contain) | |
| \`shape\` | \`shape\` (rect/circle/pill/diamond), \`fill?\`, \`stroke?\`, \`label?\`, \`color?\` | the nodes of a diagram |
| \`arrow\` | \`from\`, \`to\` (element ids), \`label?\`, \`color?\`, \`curve?\` (-1 to 1) | no x/y: it joins two elements, draws itself and follows them |
| \`number\` | \`value\`, \`label?\`, \`prefix?\`, \`suffix?\`, \`decimals?\`, \`size?\`, \`color?\` | counts up when it enters |
| \`note\` | \`tone\` (tip/definition/warning/note), \`md\` | a small callout chip |

Colours are Kalami's tokens: \`ink\`, \`paper\`, \`graphite\`, \`panel\`, \`card\`,
\`charcoal\`, \`highlighter\`, \`highlighter-deep\`, \`red-pen\`, \`ok\`, \`warn\`.

Steps (up to 30, each \`{ "note?", "actions": [...] }\`, 1 to 12 actions; the note
is a caption under the stage). Actions, each with optional \`at\` (seconds after
the step starts; otherwise they follow each other with a little overlap) and
\`duration\`:

| do | fields | what happens |
|---|---|---|
| \`enter\` | \`targets\`, \`effect?\`, \`stagger?\` | brings elements in: fade, rise, drop, slide-left, slide-right, pop, cascade, wipe, draw (arrows), count (numbers), type (code). Left out, each kind picks its best |
| \`exit\` | \`targets\`, \`effect?\`, \`stagger?\` | fade, sink, shrink, slide-left, slide-right |
| \`emphasize\` | \`targets\`, \`effect?\` | pulse, shake, glow, flash, bounce |
| \`focus\` | \`targets\` | dims everything else; \`[]\` lifts the focus |
| \`move\` | \`target\`, \`x?\`, \`y?\`, \`w?\`, \`h?\` | glides an element; its arrows follow |
| \`camera\` | \`target?\` or \`x?\`, \`y?\`, \`scale?\` (1 to 4) | zooms on an element or a point; with nothing, back to the whole stage |

An element no step enters is on the stage from the start. Keep text short and
big: a scene is watched, not read. Three to six steps with one idea each beat
one step that does everything.

~~~json
{ "type": "scene", "scene": {
  "title": "How a request travels",
  "theme": "ink",
  "elements": [
    { "id": "title", "kind": "heading", "text": "From address bar to pixels", "x": 80, "y": 60, "w": 1040, "size": "lg", "align": "center" },
    { "id": "browser", "kind": "shape", "shape": "pill", "fill": "paper", "label": "Browser", "x": 90, "y": 300, "w": 260, "h": 110 },
    { "id": "server", "kind": "shape", "shape": "rect", "fill": "highlighter", "label": "Web server", "x": 850, "y": 300, "w": 260, "h": 110 },
    { "id": "request", "kind": "arrow", "from": "browser", "to": "server", "label": "GET /" },
    { "id": "aside", "kind": "note", "tone": "definition", "md": "**GET** asks for a page without changing anything.", "x": 400, "y": 460, "w": 420, "h": 100 }
  ],
  "steps": [
    { "note": "Two machines.", "actions": [ { "do": "enter", "targets": ["title"] }, { "do": "enter", "targets": ["browser", "server"], "stagger": 0.2 } ] },
    { "note": "The browser asks.", "actions": [ { "do": "enter", "targets": ["request"] }, { "do": "camera", "target": "server", "scale": 1.5, "at": 0.8 } ] },
    { "actions": [ { "do": "camera" }, { "do": "enter", "targets": ["aside"] }, { "do": "emphasize", "targets": ["request"], "effect": "pulse", "at": 0.6 } ] }
  ]
} }
~~~

## Presentations

A week can hold presentations next to its lessons: decks of typed slides in a
theme, which students watch in Kalami's player and lecturers present full
screen. Every slide type has its own designed layout and animation (headings
rise line by line, statements arrive word by word, numbers count up, code
types itself, diagrams draw their arrows), so a slide is only its \`type\` and
its words. Nothing is positioned or coloured by hand.

\`{ "title", "theme"?, "slides": [...] }\`. Themes: \`ink\` (dark with neon lime,
the default), \`paper\` (light, highlighter marks), \`aurora\` (night sky with
drifting colour), \`ember\` (warm cream and orange), \`chalk\` (a chalkboard).

Every slide may also have \`tone\` (\`"accent"\` fills the slide with the theme's
colour; sections are accent unless set to \`"default"\`) and \`notes\` (speaker
notes; students can open them too). In slide text, \`**double asterisks**\` draw
the theme's accent mark on a few words, and backticks make \`code\`.

| type | fields | notes |
|---|---|---|
| \`title\` | \`title\`, \`subtitle?\`, \`kicker?\` | the opening slide |
| \`section\` | \`title\`, \`kicker?\` | a chapter break with a big running number |
| \`statement\` | \`text\`, \`kicker?\` | one very large sentence |
| \`points\` | \`title?\`, \`points\` (2 to 6), \`build?\` | \`build: true\`: one point per Next |
| \`number\` | \`value\`, \`label\`, \`prefix?\`, \`suffix?\`, \`decimals?\`, \`detail?\` | counts up to the value |
| \`compare\` | \`title?\`, \`left\` and \`right\` ({ \`title\`, \`points\` 1 to 5 }), \`verdict?\` | two sides |
| \`quote\` | \`quote\`, \`author?\`, \`role?\` | quote real sources accurately |
| \`code\` | \`title?\`, \`language\`, \`code\` (up to 22 lines), \`highlights?\` [{ \`from\`, \`to?\`, \`note?\` }] | each Next highlights lines |
| \`image\` | \`url\` (https), \`alt\`, \`title?\`, \`caption?\`, \`layout?\` (\`split\` or \`full\`) | |
| \`diagram\` | \`title?\`, \`layout\` (\`flow\`, \`cycle\`, \`stack\`, \`hub\`), \`nodes\` (2 to 8: \`label\`, \`detail?\`, \`edge?\`), \`build?\` | arrows are drawn for you; \`edge\` labels the arrow into a node |
| \`closing\` | \`title\`, \`points?\` (up to 5), \`next?\` | the end |

Write like a speaker, not a document: one idea per slide, very few words
(a statement under 15 words, points under 10 words each), 8 to 20 slides. Open
with \`title\`, put a \`section\` before each part, end with \`closing\`. Mix types
(statement, number, diagram, compare, quote, code) rather than many points
slides, and mark one or two words per slide.

~~~json
{
  "title": "How the web works",
  "theme": "aurora",
  "slides": [
    { "type": "title", "kicker": "Week 1 · Web basics", "title": "How the **web** works" },
    { "type": "statement", "text": "Every page is a **conversation** between two computers." },
    { "type": "diagram", "title": "What happens when you press Enter", "layout": "flow", "build": true,
      "nodes": [ { "label": "Browser" }, { "label": "DNS", "edge": "kalami.space?" }, { "label": "Server", "edge": "GET /" } ] },
    { "type": "number", "value": 200, "label": "means **OK**: the server found the page" },
    { "type": "closing", "title": "Now you can **see** the web", "points": [ "Requests ask, responses answer" ],
      "next": "Next week: your first HTML page" }
  ]
}
~~~

## Assessments (tasks, quizzes, midterms, finals)

~~~json
{
  "kind": "quiz",
  "title": "Quiz 2 · Selectors",
  "instructions": "Ten questions, 15 minutes.",
  "settings": { "timeLimitMin": 15, "attemptsAllowed": 1 },
  "questions": []
}
~~~

- \`kind\`: \`task\` (homework, usually a code task), \`quiz\`, \`midterm\`, \`final\`.
  Tasks and quizzes go in a week's \`assessments\` (or \`other\`); midterms and
  finals go in \`exams\`.
- \`settings\` (all optional; Kalami's defaults for the kind fill the rest):
  \`timeLimitMin\` (1 to 600), \`attemptsAllowed\` (1 to 10), \`shuffleQuestions\`,
  \`shuffleOptions\`, \`integrityLevel\` (\`off\` practice, \`standard\`, \`strict\`
  fullscreen exam), \`resultsVisibility\` (\`hidden\`, \`score\`, \`full_after_close\`).
  Never dates.
- \`questions\`: up to 200, in order. Correct answers are marked inside them.

### Questions

| type | fields |
|---|---|
| \`single\` | \`prompt\`, \`options\` (2 to 10, exactly one \`correct: true\`), \`points?\`, \`explanation?\` |
| \`multiple\` | \`prompt\`, \`options\` (at least one correct), \`points?\`, \`explanation?\` |
| \`short\` | \`prompt\`, \`acceptedAnswers\` (1 to 20), \`caseSensitive?\`, \`points?\`, \`explanation?\` |
| \`essay\` | \`prompt\`, \`rubric?\` (only the lecturer sees it), \`points?\` |
| \`code\` | an HTML/CSS task in steps, see below |

\`points\` defaults to 1 (0 to 100). \`explanation\` is shown to students with full
results after the assessment closes.

~~~json
{ "type": "single", "prompt": "Which property sets text colour?", "points": 1,
  "options": [ { "text": "color", "correct": true }, { "text": "font-color", "correct": false } ],
  "explanation": "\`color\` sets the text colour; \`font-color\` doesn't exist." }
~~~

### Code tasks (HTML and CSS)

Written by hand in Kalami's sandbox, checked live as students type, no
JavaScript. Fields: \`prompt\`, \`starterFiles\` ([{ \`name\`, \`content\` }], e.g.
\`index.html\`, \`style.css\`), \`steps\` ([{ \`title\`, \`instructions\` (Markdown), \`hint?\`,
\`checks\` }]), \`hiddenChecks?\` (run on submit only), \`solution\` (the finished files),
\`assets?\` (images by short name), \`variables?\` (per-student values used as
\`{{name}}\`).

Check types: \`exists\` / \`not_exists\` (\`selector\`), \`count\` (\`selector\`, \`min?\`,
\`max?\`), \`text\` (\`selector\`, \`equals?\` / \`contains?\`), \`attr\` (\`selector\`, \`attribute\`,
\`equals?\` / \`contains?\`), \`css\` (\`selector\`, \`property\`, \`equals?\` / \`oneOf?\`), \`linked\`
(\`href\` of a stylesheet). Every check has a \`label\` students read.

Rules: teach one new thing per step; each step fails on the starter files and
its checks stay true after later steps; **every check must pass on the
solution**, or the import is refused. Through the Kalami MCP connector,
\`check_code_task\` tests a task before you put it in a file.

## A complete small file

~~~json
{
  "format": "kalami", "version": 1, "kind": "course",
  "exported": { "by": "Claude", "at": "2026-10-04T20:00:00Z", "from": "Claude" },
  "course": {
    "title": "CSS in one week", "language": "en",
    "weeks": [ {
      "title": "Week 1 · Selectors",
      "description": "How CSS chooses what to style.",
      "links": [ { "title": "MDN: CSS selectors", "url": "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_selectors" } ],
      "lessons": [ { "title": "Choosing elements", "blocks": [
        { "type": "text", "md": "Every CSS rule starts with a **selector**." },
        { "type": "code", "language": "css", "code": "h1 {\\n  color: tomato;\\n}", "preview": true },
        { "type": "check", "check": { "kind": "short", "prompt": "Selector for every paragraph?", "accepted": ["p"],
          "explanation": "A tag name selects every element of that type." } }
      ] } ],
      "assessments": [ { "kind": "quiz", "title": "Selectors quiz", "questions": [
        { "type": "single", "prompt": "Which selector picks class \`card\`?",
          "options": [ { "text": ".card", "correct": true }, { "text": "#card", "correct": false } ] }
      ] } ]
    } ],
    "exams": [ { "kind": "final", "title": "Final exam", "settings": { "timeLimitMin": 60 }, "questions": [
      { "type": "essay", "prompt": "Explain the cascade in your own words.", "points": 10, "rubric": "Specificity, order, inheritance." }
    ] } ]
  }
}
~~~

## Checking a file

Kalami checks everything before it creates anything, and lists each problem
with where it is, e.g. \`course › weeks[1] › lessons[0] › blocks[3] › alt: Too small\`.
Fix those and try again; nothing is created until the whole file is right.
With the Kalami MCP connector: \`check_kalami_file\` (a dry run), then
\`import_kalami_file\`.

## Common mistakes

- A \`single\` question with two correct options, or a \`multiple\` with none.
- \`http://\` links or image URLs (only \`https://\`).
- An \`image\` without \`alt\`.
- Midterms or finals inside a week (they go in \`exams\`), or tasks in \`exams\`.
- Dates in \`settings\`.
- Writing \`signature\`, or ids.
- Mixing languages: write everything in the course's \`language\`.
`;
