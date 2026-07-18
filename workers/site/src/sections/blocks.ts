import type { BlockCatalog } from "louise-toolkit/content";

// The site's catalog of block types — the block-level analogue of ./catalog.ts
// (SCHEMA ONLY; the bespoke render lives in the section components). A block is
// one item of a section's first-class `blocks` layer (ADR 0005); block fields
// reuse `SectionField`, so they validate exactly like a section's fields.
//
// `feature` is the reference-slice block (#182): the feature-grid's cards,
// promoted from a homogeneous `items` array to a real block type. `name`/`body`
// are edited in place on the card; `icon`/`colorway` stay site-owned tokens
// (dock/inspector fields), so the exact look stays the site's call.
//
// `cta` + `install` are the hero's action row (#182 reference slice): unlike
// featureGrid's homogeneous cards, the hero promotes a **mixed** ordered list —
// a button and an install-command chip — into `blocks`, so the catalog carries
// two block types and the section renders each by `_type`. The CTA's label is
// edited in place; the link target + the command are dock fields (no clean
// visible node to click).
export const BLOCKS: BlockCatalog = {
  feature: {
    label: "Feature",
    icon: "ph ph-squares-four",
    fields: {
      name: { type: "text", label: "Name", placeholder: "e.g. content" },
      body: { type: "textarea", label: "Body", placeholder: "What it does" },
      icon: { type: "text", label: "Icon (ph-…)", placeholder: "ph-database", inline: false },
      colorway: {
        type: "text",
        label: "Color (blue/orange/green/gold)",
        placeholder: "blue",
        inline: false,
      },
    },
  },
  cta: {
    label: "Button",
    icon: "ph ph-cursor-click",
    fields: {
      label: { type: "text", label: "Button label", placeholder: "Get started" },
      href: { type: "text", label: "Button link", placeholder: "https://…", inline: false },
    },
  },
  install: {
    label: "Install command",
    icon: "ph ph-terminal-window",
    fields: {
      command: {
        type: "text",
        label: "Install command",
        placeholder: "pnpm add louise-toolkit",
        inline: false,
      },
    },
  },
};
