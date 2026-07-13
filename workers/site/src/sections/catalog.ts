import type { SectionCatalog } from "louise/client";

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
  // from the built-in `inquiries` form (louise/forms), which owns validation.
  contact: {
    label: "Contact form",
    icon: "ph ph-envelope",
    fields: {
      heading: { type: "text", label: "Heading", placeholder: "Section heading" },
      blurb: { type: "textarea", label: "Blurb", placeholder: "Supporting text" },
    },
  },
};
