import type { SectionCatalog } from "louise-toolkit/client";

// The site's catalog of preconfigured section types — SCHEMA ONLY (field defs);
// the bespoke render components live in ./*.astro and are wired in
// ../components/Sections.astro. This fields-only catalog is what the on-page
// block-builder (SectionsMount → mountSections) reads to render each section's
// edit form and the "+ Add section" palette.
export const SECTIONS: SectionCatalog = {
  // The action row (button + install chip) is now a first-class `blocks` layer
  // (#182 / ADR 0005): a mixed, ordered list of `cta` / `install` blocks (see
  // ./blocks.ts), each on-canvas (blue ring/toolbar), reorderable in place —
  // rather than the flat ctaLabel/ctaHref/installCommand fields. badge/heading/
  // headingAccent/tagline stay direct section fields.
  hero: {
    label: "Hero",
    icon: "ph ph-rocket",
    fields: {
      badge: { type: "text", label: "Eyebrow badge", placeholder: "V8-NATIVE · RUNS ON …" },
      heading: { type: "text", label: "Heading", placeholder: "Add a heading" },
      headingAccent: {
        type: "text",
        label: "Heading (accent line)",
        placeholder: "Colored second line",
      },
      tagline: { type: "textarea", label: "Tagline", placeholder: "Add a tagline" },
    },
    blocks: { allow: ["cta", "install"] },
  },
  // Reference slice for the first-class block layer (#182 / ADR 0005): the grid's
  // cards are now `feature` blocks (see ./blocks.ts) rather than a homogeneous
  // `items` array — each card is an on-canvas block (blue ring/toolbar), reordered
  // and deleted in place. `heading`/`headingLine2` stay direct section fields.
  featureGrid: {
    label: "Feature grid",
    icon: "ph ph-squares-four",
    fields: {
      heading: { type: "text", label: "Heading", placeholder: "Section heading" },
      headingLine2: { type: "text", label: "Heading (line 2)", placeholder: "Second line" },
    },
    blocks: { allow: ["feature"] },
    // Inspector layout + settings (#182 Phase 4 / ADR 0005 §5). Louise stores the
    // chosen tokens; FeatureGrid.astro maps them to grid columns + a background.
    layouts: {
      two: { label: "2 columns" },
      three: { label: "3 columns" },
      four: { label: "4 columns" },
    },
    settings: {
      background: {
        type: "text",
        label: "Background (none / muted / dark)",
        placeholder: "none",
        inline: false,
      },
    },
  },
  editDemo: {
    label: "Edit-in-place demo",
    icon: "ph ph-cursor-text",
    fields: {
      heading: { type: "text", label: "Heading", placeholder: "Click it." },
      headingAccent: { type: "text", label: "Heading (accent line)", placeholder: "Type it." },
    },
  },
  codeShowcase: {
    label: "Code showcase",
    icon: "ph ph-code",
    fields: {
      heading: { type: "text", label: "Heading", placeholder: "Bring your" },
      headingAccent: { type: "text", label: "Heading (accent word)", placeholder: "everything." },
      body: { type: "textarea", label: "Body", placeholder: "Supporting text" },
      linkLabel: { type: "text", label: "Link label", placeholder: "Read the docs →" },
      linkHref: { type: "text", label: "Link target", placeholder: "https://…", inline: false },
    },
  },
  ctaSection: {
    label: "Closing CTA",
    icon: "ph ph-flag",
    fields: {
      heading: { type: "text", label: "Heading", placeholder: "Ship it" },
      headingAccent: { type: "text", label: "Heading (accent word)", placeholder: "today." },
      ctaLabel: { type: "text", label: "Button label", placeholder: "Get started →" },
      ctaHref: { type: "text", label: "Button link", placeholder: "https://…", inline: false },
      subtext: { type: "text", label: "Subtext", placeholder: "MIT licensed · deploys to the edge" },
    },
  },
  banner: {
    label: "Banner",
    icon: "ph ph-megaphone",
    fields: {
      heading: { type: "text", label: "Heading", placeholder: "Add a heading" },
      body: { type: "textarea", label: "Body", placeholder: "Add supporting text" },
      ctaLabel: { type: "text", label: "Button label", placeholder: "Button text" },
      // Edited in the dock — a link target has no visible text to click on.
      ctaHref: { type: "text", label: "Button link", placeholder: "https://…", inline: false },
    },
  },
  testimonial: {
    label: "Testimonials",
    icon: "ph ph-quotes",
    fields: {
      heading: { type: "text", label: "Heading (optional)", placeholder: "Section heading" },
      items: {
        type: "array",
        label: "Quotes",
        itemLabel: "Quote",
        itemFields: {
          quote: { type: "textarea", label: "Quote", placeholder: "What they said" },
          author: { type: "text", label: "Author", placeholder: "Name" },
          role: { type: "text", label: "Role", placeholder: "Title, Company" },
        },
      },
    },
  },
  media: {
    label: "Media",
    icon: "ph ph-image",
    fields: {
      // Uploaded via the dock upload/clear control; renders a placeholder until set.
      image: { type: "image", label: "Image" },
      // Edited in the dock — alt text has no visible node to edit in place.
      alt: { type: "text", label: "Alt text", placeholder: "Describe the image", inline: false },
      caption: { type: "text", label: "Caption", placeholder: "Add a caption" },
    },
  },
  // Contact form — only the surrounding copy is section-edited; the inputs come
  // from the built-in `inquiries` form (louise-toolkit/forms), which owns validation.
  contact: {
    label: "Contact form",
    icon: "ph ph-envelope",
    fields: {
      heading: { type: "text", label: "Heading", placeholder: "Section heading" },
      blurb: { type: "textarea", label: "Blurb", placeholder: "Supporting text" },
    },
  },
};
