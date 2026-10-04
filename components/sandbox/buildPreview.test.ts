import { describe, expect, test } from "vitest";
import { buildPreviewHtml } from "./buildPreview";

const CAT = { name: "cat.jpg", url: "https://ik.imagekit.io/kalami/cat.jpg" };

/** Where the policy ends up: it must be the first thing inside the real <head> (comments don't count). */
function headStart(html: string): string {
  return /<head>([\s\S]{0,120})/i.exec(html.replace(/<!--[\s\S]*?-->/g, ""))?.[1] ?? "";
}

describe("the preview document", () => {
  test("puts the policy first in the head, whatever the student writes around it", () => {
    const payloads = [
      "<h1>Hi</h1>",
      "<!DOCTYPE html><html><head><title>x</title></head><body><p>y</p></body></html>",
      // A head tag inside a comment used to fool the old regex.
      '<!-- <head> --><link rel="stylesheet" href="https://attacker.example/x.css">',
      // Body content before a head tag: the browser ignores the later head.
      '<div></div><head></head><body><img src="https://attacker.example/p.png"></body>',
      // A fetch before any head.
      '<link rel="stylesheet" href="https://attacker.example/x.css"><head>',
    ];
    for (const payload of payloads) {
      const html = buildPreviewHtml([{ name: "index.html", content: payload }], []);
      expect(headStart(html)).toMatch(/^<meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
      expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
    }
  });

  test("drops what could navigate, embed or run, however it is spelled", () => {
    const html = buildPreviewHtml(
      [
        {
          name: "index.html",
          content: [
            '<meta http-equiv="&#114;efresh" content="0;url=https://attacker.example">',
            '<meta content="0;url=https://attacker.example" x=">" http-equiv="refresh">',
            '<META HTTP-EQUIV=" Refresh " content="1">',
            "<script>alert(1)</script>",
            '<iframe src="https://attacker.example"></iframe>',
            '<object data="x"></object><embed src="y"><base href="https://attacker.example/">',
            "<p>kept</p>",
          ].join(""),
        },
      ],
      [],
    );
    expect(html).not.toMatch(/refresh/i);
    expect(html).not.toMatch(/<script|<iframe|<object|<embed|<base/i);
    expect(html).toContain("<p>kept</p>");
  });

  test("inlines the linked stylesheet and points images at the task's assets", () => {
    const html = buildPreviewHtml(
      [
        {
          name: "index.html",
          content:
            '<html><head><link rel="stylesheet" href="./style.css?v=1"><link rel="stylesheet" href="https://x/y.css"></head>' +
            '<body><img src="cat.jpg" srcset="cat.jpg 2x, other.jpg 1x" style="background: url(cat.jpg)"><a href="cat.jpg">x</a></body></html>',
        },
        { name: "style.css", content: ".card { background: url('cat.jpg'); } /* </style> */" },
      ],
      [CAT],
    );
    expect(html).toContain(`<style>.card { background: url('${CAT.url}'); } /* <\\/style> */</style>`);
    // An outside stylesheet stays as a link the policy will block.
    expect(html).toContain('<link rel="stylesheet" href="https://x/y.css">');
    expect(html).toContain(`<img src="${CAT.url}" srcset="${CAT.url} 2x, other.jpg 1x" style="background: url(${CAT.url})">`);
    expect(html).toContain(`<a href="${CAT.url}">`);
  });

  test("keeps the doctype and a page without a head", () => {
    const html = buildPreviewHtml([{ name: "index.html", content: "<!DOCTYPE html><p>hello</p>" }], []);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<p>hello</p>");
    expect(headStart(html)).toContain("Content-Security-Policy");
  });
});
