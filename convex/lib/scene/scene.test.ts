import { describe, expect, test } from "vitest";
import { arrowEnds, arrowGeometry, cameraAt, cameraFor, elementBox, initiallyShown, sceneProblems, sceneText, type Scene } from "./index";

const scene: Scene = {
  title: "A request",
  elements: [
    { id: "title", kind: "heading", text: "Hello", x: 80, y: 60, w: 600 },
    { id: "a", kind: "shape", shape: "rect", label: "Browser", x: 100, y: 300, w: 200, h: 100 },
    { id: "b", kind: "shape", shape: "rect", label: "Server", x: 800, y: 300, w: 200, h: 100 },
    { id: "ab", kind: "arrow", from: "a", to: "b", label: "GET /" },
    { id: "n", kind: "number", value: 200, suffix: " OK", x: 500, y: 500 },
  ],
  steps: [
    { note: "Two machines", actions: [{ do: "enter", targets: ["title"] }, { do: "enter", targets: ["a", "b"], stagger: 0.2 }] },
    { actions: [{ do: "enter", targets: ["ab"] }, { do: "camera", target: "b", scale: 1.5, at: 0.8 }] },
    { actions: [{ do: "camera" }, { do: "focus", targets: [] }, { do: "move", target: "a", x: 50 }] },
  ],
};

describe("scene rules", () => {
  test("a good scene has no problems", () => {
    expect(sceneProblems(scene)).toEqual([]);
  });

  test("ids must be unique and well formed; targets and arrow ends must exist", () => {
    const bad: Scene = {
      elements: [
        { id: "Title", kind: "heading", text: "x", x: 0, y: 0 },
        { id: "a", kind: "shape", shape: "rect", x: 0, y: 0 },
        { id: "a", kind: "shape", shape: "rect", x: 0, y: 0 },
        { id: "arr", kind: "arrow", from: "a", to: "nope" },
        { id: "self", kind: "arrow", from: "a", to: "a" },
      ],
      steps: [{ actions: [{ do: "enter", targets: ["ghost"] }, { do: "move", target: "arr", x: 10 }, { do: "camera", target: "arr" }] }],
    };
    const problems = sceneProblems(bad);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('elements[0].id: use 1 to 32 lowercase'),
        expect.stringContaining('elements[2].id: "a" is used twice'),
        expect.stringContaining('elements[3].to: no element with id "nope"'),
        expect.stringContaining("elements[4]: from and to must be different"),
        expect.stringContaining('no element with id "ghost"'),
        expect.stringContaining("arrows follow their ends"),
        expect.stringContaining("frame one of the arrow's ends"),
      ]),
    );
  });

  test("positions stay on the stage and limits hold", () => {
    const off: Scene = {
      elements: [
        { id: "a", kind: "heading", text: "x", x: 1100, y: 0, w: 400 },
        { id: "b", kind: "text", md: "", x: 0, y: 700 },
        { id: "c", kind: "code", language: "cobol", code: Array(30).fill("x").join("\n"), x: 0, y: 0 },
        { id: "d", kind: "image", url: "http://x.example.com/a.png", alt: "", x: 0, y: 0 },
        { id: "e", kind: "number", value: 1, decimals: 9, x: 0, y: 0 },
      ],
      steps: [{ actions: [] }, { actions: [{ do: "enter", targets: ["a"], at: 99, duration: 0, stagger: 5 }, { do: "move", target: "a" }] }],
    };
    const problems = sceneProblems(off);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("elements[0]: x + w goes past the stage's width"),
        expect.stringContaining("elements[1].y: 0 to 675"),
        expect.stringContaining("elements[1].md: 1 to 1500"),
        expect.stringContaining("elements[2].language"),
        expect.stringContaining("elements[2].code: at most 24 lines"),
        expect.stringContaining("elements[3].url: an https:// link"),
        expect.stringContaining("elements[3].alt"),
        expect.stringContaining("elements[4].decimals: 0 to 4"),
        expect.stringContaining("steps[0].actions: a step needs at least one action"),
        expect.stringContaining("steps[1].actions[0].at: 0 to 10"),
        expect.stringContaining("steps[1].actions[0].duration: 0.1 to 6"),
        expect.stringContaining("steps[1].actions[0].stagger: 0 to 1"),
        expect.stringContaining("steps[1].actions[1]: give x, y, w or h"),
      ]),
    );
    expect(sceneProblems({ elements: [], steps: [] })).toEqual([
      "elements: add at least one element.",
      "steps: add at least one step.",
    ]);
  });

  test("elements no step enters are shown from the start", () => {
    expect([...initiallyShown(scene)]).toEqual(["n"]);
  });

  test("boxes get their default size per kind", () => {
    expect(elementBox(scene.elements[0])).toEqual({ x: 80, y: 60, w: 600, h: 120 });
    expect(elementBox(scene.elements[3])).toBeNull();
  });

  test("the scene's words are searchable", () => {
    const text = sceneText(scene);
    for (const word of ["A request", "Hello", "Browser", "Server", "GET /", "200 OK", "Two machines"]) expect(text).toContain(word);
  });
});

describe("scene geometry", () => {
  const left = { x: 100, y: 300, w: 200, h: 100 };
  const right = { x: 800, y: 300, w: 200, h: 100 };

  test("an arrow leaves and reaches the boxes' edges, with a gap", () => {
    const { start, end } = arrowEnds(left, right);
    expect(start).toEqual({ x: 310, y: 350 });
    expect(end).toEqual({ x: 790, y: 350 });
    // Straight down: leaves the bottom edge, reaches the top edge.
    const below = { x: 100, y: 500, w: 200, h: 100 };
    expect(arrowEnds(left, below)).toEqual({ start: { x: 200, y: 410 }, end: { x: 200, y: 490 } });
  });

  test("a straight arrow is a line pointing right; a curved one is a quadratic bowed off the midpoint", () => {
    const straight = arrowGeometry(left, right);
    expect(straight.d).toBe("M 310 350 L 790 350");
    expect(straight.angle).toBe(0);
    expect(straight.mid).toEqual({ x: 550, y: 350 });
    const curved = arrowGeometry(left, right, 0.5);
    expect(curved.d.startsWith("M 310 350 Q ")).toBe(true);
    expect(curved.mid.y).toBeGreaterThan(350);
    expect(curved.angle).toBeLessThan(0);
  });

  test("the camera frames a box with room around it and never leaves the stage", () => {
    // The box fits 1.5 times over: zoom 4, and its centre (900, 350) sits in the middle of the view.
    expect(cameraFor(right)).toEqual({ x: -3000, y: -1062.5, scale: 4 });
    expect(cameraFor({ x: 0, y: 0, w: 1200, h: 675 })).toEqual({ x: 0, y: 0, scale: 1 });
    expect(cameraFor(right, 9).scale).toBe(4);
    expect(cameraAt(0, 0, 2)).toEqual({ x: 0, y: 0, scale: 2 });
    expect(cameraAt(1200, 675, 2)).toEqual({ x: -1200, y: -675, scale: 2 });
    expect(cameraAt(600, 337.5, 1)).toEqual({ x: 0, y: 0, scale: 1 });
  });
});
