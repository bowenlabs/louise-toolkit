// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Minimal TipTap-JSON → HTML read-side renderer. Turns stored rich-text JSON
// into an HTML string for a public site — only the node/mark types listed
// below, no round-trippable editor format.

/** Minimal structural shape this renderer depends on — not the full TipTap
 *  JSONContent type (avoids pulling @tiptap/core in just for a type import). */
export interface TipTapJSONContent {
  type?: string;
  text?: string;
  content?: TipTapJSONContent[];
  marks?: { type: string }[];
}

const MARK_TAGS: Record<string, string> = {
  bold: "strong",
  italic: "em",
  code: "code",
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderInline(node: TipTapJSONContent): string {
  if (node.type === "text") {
    const text = escapeHtml(node.text ?? "");
    return (node.marks ?? []).reduce((html, mark) => {
      const tag = MARK_TAGS[mark.type];
      return tag ? `<${tag}>${html}</${tag}>` : html;
    }, text);
  }
  return (node.content ?? []).map(renderInline).join("");
}

const BLOCK_TAGS: Record<string, string> = {
  paragraph: "p",
  heading: "h2",
  bulletList: "ul",
  orderedList: "ol",
  listItem: "li",
  blockquote: "blockquote",
};

function renderNode(node: TipTapJSONContent): string {
  if (node.type === "text") return renderInline(node);
  const tag = node.type ? BLOCK_TAGS[node.type] : undefined;
  const inner = (node.content ?? []).map(renderNode).join("");
  return tag ? `<${tag}>${inner}</${tag}>` : inner;
}

/** Render TipTap JSON content to an HTML string (read-side only). */
export function renderRichText(content: TipTapJSONContent): string {
  return (content.content ?? []).map(renderNode).join("");
}
