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
      heading: { type: "text", label: "Heading", placeholder: "Add a heading" },
      tagline: { type: "textarea", label: "Tagline", placeholder: "Add a tagline" },
      ctaLabel: { type: "text", label: "Button label", placeholder: "Button text" },
      // Edited in the dock — a link target has no visible text to click on.
      ctaHref: { type: "text", label: "Button link", placeholder: "https://…", inline: false },
      // Uploadable logo image (dock upload/clear); falls back to the Louise mark.
      logo: { type: "image", label: "Logo" },
    },
  },
  featureGrid: {
    label: "Feature grid",
    icon: "ph ph-squares-four",
    fields: {
      heading: { type: "text", label: "Heading (optional)", placeholder: "Section heading" },
      items: {
        type: "array",
        label: "Features",
        itemLabel: "Feature",
        itemFields: {
          title: { type: "text", label: "Title", placeholder: "Feature title" },
          body: { type: "textarea", label: "Body", placeholder: "Feature description" },
        },
      },
    },
  },
};
