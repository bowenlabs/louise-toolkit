import type { SectionCatalog } from "louisecms/client";

// The site's catalog of preconfigured section types — SCHEMA ONLY (field defs);
// the bespoke render components live in ./*.astro and are wired in
// ../components/Sections.astro. This fields-only catalog is what the on-page
// block-builder (SectionsMount → mountSections) reads to render each section's
// edit form and the "+ Add section" palette.
export const SECTIONS: SectionCatalog = {
  hero: {
    label: "Hero",
    icon: "ph ph-rocket",
    fields: {
      heading: { type: "text", label: "Heading" },
      tagline: { type: "textarea", label: "Tagline" },
      ctaLabel: { type: "text", label: "Button label", placeholder: "Read the docs" },
      ctaHref: { type: "text", label: "Button link", placeholder: "https://…" },
    },
  },
  featureGrid: {
    label: "Feature grid",
    icon: "ph ph-squares-four",
    fields: {
      heading: { type: "text", label: "Heading (optional)" },
      items: {
        type: "array",
        label: "Features",
        itemLabel: "Feature",
        itemFields: {
          title: { type: "text", label: "Title" },
          body: { type: "textarea", label: "Body" },
        },
      },
    },
  },
};
