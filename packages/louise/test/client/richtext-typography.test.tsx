// @vitest-environment happy-dom
import { defineBasicExtension } from "prosekit/basic";
import { createEditor, union } from "prosekit/core";
import { afterEach, describe, expect, it } from "vitest";
import { mountRichText } from "../../src/client/RichText.jsx";
import { defineLanguageMark, defineTypography } from "../../src/client/typography.js";
import { sanitizeRichHtml } from "../../src/core/security/index.js";

// #606: typographic input rules a site turns on, and phrases marked as another
// language with `<span lang>`.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

/** A bare editor with the rules, and a way to "type" into it. */
function typist(quotes?: string) {
  const editor = createEditor({
    extension: union(defineBasicExtension(), defineTypography({ quotes })),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  editor.mount(host);
  cleanups.push(() => {
    editor.unmount();
    host.remove();
  });
  const type = (text: string) => {
    for (const ch of text) {
      const view = editor.view;
      const { from, to } = view.state.selection;
      const handled = view.someProp("handleTextInput", (f) =>
        f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
      );
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
    return editor.view.state.doc.textContent;
  };
  return { type };
}

describe("typography input rules", () => {
  it("turns -- into an em dash and ... into an ellipsis", () => {
    expect(typist().type("wait--then...")).toBe("wait—then…");
  });

  it("leaves quotes straight without a pair", () => {
    expect(typist().type(`say "hi"`)).toBe(`say "hi"`);
  });

  it("uses the site's quote marks, opening after a space and closing after a word", () => {
    expect(typist("“”‘’").type(`say "hi" and 'bye'`)).toBe("say “hi” and ‘bye’");
    expect(typist("«»‹›").type(`dit "oui"`)).toBe("dit «oui»");
  });
});

describe("the lang mark", () => {
  it("keeps <span lang> through the editor, and drops an invalid tag", async () => {
    const el = document.createElement("div");
    el.innerHTML = '<p>Say <span lang="fr">bonjour</span> and <span lang="x!">hi</span></p>';
    document.body.appendChild(el);
    const rt = mountRichText(el, () => {}, undefined, { language: true });
    cleanups.push(() => {
      rt.destroy();
      el.remove();
    });
    await new Promise((r) => setTimeout(r, 30));
    const html = rt.getHTML();
    expect(html).toContain('<span lang="fr">bonjour</span>');
    expect(html).not.toContain('lang="x!"');
  });

  it("is in the schema on a bare editor", () => {
    const editor = createEditor({ extension: union(defineBasicExtension(), defineLanguageMark()) });
    expect(editor.schema.marks.lang).toBeDefined();
  });
});

describe("sanitizeRichHtml and lang", () => {
  it("keeps a BCP 47 lang on a span, and drops anything else", () => {
    expect(sanitizeRichHtml('<p><span lang="pt-BR">oi</span></p>')).toBe(
      '<p><span lang="pt-BR">oi</span></p>',
    );
    expect(sanitizeRichHtml('<p><span lang="en&quot; onclick=&quot;x">x</span></p>')).not.toContain(
      "lang",
    );
    expect(sanitizeRichHtml('<p lang="fr">x</p>')).toBe("<p>x</p>");
  });
});
