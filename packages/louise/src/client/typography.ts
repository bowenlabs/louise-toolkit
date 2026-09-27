// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Rich-text typography (#606): the `lang` mark that marks a phrase as another
// language, and the opt-in input rules for dashes, an ellipsis, and a
// language's quote marks. Kept out of RichText.tsx so each can be tested on a
// bare editor.

import { InputRule } from "@prosekit/pm/inputrules";
import { defineMarkSpec, union } from "prosekit/core";
import { defineInputRule } from "prosekit/extensions/input-rule";
import type { RichTextTypography } from "../core/content/sections.js";

/** A BCP 47 tag's shape, as the sanitizer checks it (`fr`, `pt-BR`). */
export const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;

/**
 * The `lang` mark (#606): a phrase in another language, as `<span lang>`. Always
 * in the schema, so a stored `<span lang>` survives a round trip through the
 * editor whether or not the field shows the Language button.
 */
export function defineLanguageMark() {
  return defineMarkSpec<"lang", { lang: string }>({
    name: "lang",
    attrs: { lang: { default: "" } },
    parseDOM: [
      {
        tag: "span[lang]",
        getAttrs: (dom) => {
          const lang = (dom as HTMLElement).getAttribute("lang")?.trim() ?? "";
          return LANGUAGE_TAG.test(lang) ? { lang } : false;
        },
      },
    ],
    toDOM: (mark) => ["span", { lang: mark.attrs.lang as string }, 0],
  });
}

/** An input rule for `rule`'s last group, the one ProseMirror replaces. */
const replaceTyped = (match: RegExp, text: string) => defineInputRule(new InputRule(match, text));

/** What may come before an opening quote: the start, a space, a bracket, or
 *  another quote. Anything else makes it a closing one. */
const BEFORE_OPEN = `(?:^|[\\s{[(<'"\u2018\u201C\u00AB\u2039])`;

/**
 * Typographic input rules (#606), turned on per field: `--` to an em dash,
 * `...` to an ellipsis, and, when `quotes` names four marks, straight quotes to
 * that language's pair. Only typed text runs through input rules, never a paste.
 */
export function defineTypography(typography: RichTextTypography) {
  const rules = [replaceTyped(/--$/, "\u2014"), replaceTyped(/\.\.\.$/, "\u2026")];
  const marks = [...(typography.quotes ?? "")];
  if (marks.length === 4) {
    const [openDouble, closeDouble, openSingle, closeSingle] = marks as [
      string,
      string,
      string,
      string,
    ];
    rules.push(
      replaceTyped(new RegExp(`${BEFORE_OPEN}(")$`), openDouble),
      replaceTyped(/"$/, closeDouble),
      replaceTyped(new RegExp(`${BEFORE_OPEN}(')$`), openSingle),
      replaceTyped(/'$/, closeSingle),
    );
  }
  return union(...rules);
}
