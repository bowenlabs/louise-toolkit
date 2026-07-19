// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The section library's schema + render contract (ADR 0003 primitives, ADR 0005
// model).
//
// This file used to define a parallel universe: a `SectionProps` union
// discriminated on `kind`, with `colorway`/`align` as component props. Louise's
// actual model — the one the on-canvas editor and the write-time validator both
// read — is different in every particular, and it is the one that wins:
//
//   • a section is a stored `SectionItem`: `{ _type, blocks?, _layout?,
//     _settings?, ...fields }`. The discriminant is `_type`, not `kind`.
//   • its shape is declared once as a `SectionDef` in a `SectionCatalog`, which
//     is SCHEMA ONLY. The same object drives `mountSections` (the editor) and
//     `validateSections` (the server), so a field can't be editable-but-invalid
//     or validated-but-uneditable.
//   • presentation choices are `_settings` / `_layout` **tokens**. Louise stores
//     the token; the site maps it to CSS. That's why COLORWAY_CLASS below stays
//     — it is exactly the site-owned half of that contract — while `colorway`
//     stops being a prop and becomes a stored setting.
//
// ADR 0005 §2 names this file's job outright: "<Section> reads `_layout` /
// `_settings` and slots its children, and <Editable> already owns the
// `data-louise-*` marker contract, so a site author writes `<Editable
// field="heading">` and never hand-stamps the deeper path."
//
// Self-contained on purpose: this module ships as SOURCE (the `.astro` files
// beside it import it directly), so it must not reach back into astroid's built
// `src/*` — only siblings and external packages. The `louise-toolkit/content`
// import is TYPE-ONLY, so it erases at build and never drags the validator (or
// drizzle, which that entry pulls in) into a page bundle.

import type {
  SectionCatalog,
  SectionDef,
  SectionField,
  SectionItem,
} from "louise-toolkit/content";

export type { SectionCatalog, SectionDef, SectionField, SectionItem };

/**
 * Colorway → daisyUI surface classes, keyed to the `Theme.colors` set
 * (brand/secondary/tertiary) plus the neutral base.
 *
 * This map is the site-owned half of the token contract: Louise stores
 * `_settings.colorway = "brand"` and never learns what that renders as, so a
 * brand re-theme is a change here and no content rewrite anywhere.
 */
export const COLORWAY_CLASS = {
  brand: "bg-primary text-primary-content",
  secondary: "bg-secondary text-secondary-content",
  tertiary: "bg-accent text-accent-content",
  base: "bg-base-100 text-base-content",
} as const;
export type Colorway = keyof typeof COLORWAY_CLASS;

/** Content alignment → flex/text-alignment utilities. Same token contract. */
export const ALIGN_CLASS = {
  start: "text-start items-start",
  center: "text-center items-center",
  end: "text-end items-end",
} as const;
export type Align = keyof typeof ALIGN_CLASS;

/** Resolve a colorway token to its class string (default: neutral base). */
export function colorwayClass(colorway: string | undefined = "base"): string {
  return COLORWAY_CLASS[colorway as Colorway] ?? COLORWAY_CLASS.base;
}

/** Resolve an alignment token to its class string (default: start). */
export function alignClass(align: string | undefined = "start"): string {
  return ALIGN_CLASS[align as Align] ?? ALIGN_CLASS.start;
}

/** Title-case a token for a picker label ("brand" → "Brand"). */
const label = (token: string) => token.charAt(0).toUpperCase() + token.slice(1);

/**
 * Turn a token→class map into `select` options.
 *
 * Deriving them is the point: the options a picker offers and the tokens the
 * site can actually render are then the same list by construction, so adding a
 * colorway is one edit to `COLORWAY_CLASS` rather than an edit plus a
 * remembered second edit here that silently offers a token nothing maps.
 */
const tokenOptions = (map: Record<string, string>) =>
  Object.keys(map).map((value) => ({ value, label: label(value) }));

/**
 * The shared `_settings` every section in the catalog accepts.
 *
 * These are closed token sets, declared as `select` (#272) so the inspector
 * renders a picker and an unknown token is rejected on write. They used to be
 * `text` with the valid values stuffed into `placeholder` — which meant a typo
 * wasn't a validation error at all, just a silent fallback to the default
 * inside `colorwayClass` at render time.
 */
export const SECTION_SETTINGS: Record<string, SectionField> = {
  colorway: {
    type: "select",
    label: "Colorway",
    inline: false,
    options: tokenOptions(COLORWAY_CLASS),
    // An opaque hint — the schema layer doesn't know what a swatch looks like;
    // a renderer that doesn't support it just shows a normal picker.
    display: "swatch",
  },
  align: {
    type: "select",
    label: "Alignment",
    inline: false,
    options: tokenOptions(ALIGN_CLASS),
  },
};

/**
 * What every section render component receives.
 *
 * `base` is the whole point. It is this item's path within the page's `sections`
 * array — `"2"` for a top-level section, `"2.blocks.0"` for a block inside it —
 * and every marker the component stamps is built from it. Passing it down (rather
 * than having each component work out its own depth) is what lets the exact same
 * component render as a section or as a block, and what keeps `data-louise-sfield`
 * paths correct at any nesting depth.
 */
export interface SectionRenderProps {
  /** The stored item: `_type` plus its field values, settings, and blocks. */
  item: SectionItem;
  /** Path prefix for this item's markers (`"2"`, `"2.blocks.0"`). */
  base: string;
  /** Whether to stamp edit markers. Defaults to `Astro.locals.editMode`. */
  edit?: boolean;
  /** Alt/caption resolved from the media registry, keyed by public URL —
   *  looked up once for the whole page by `<Sections>`. */
  mediaMeta?: MediaMeta;
}

/** Asset-level `alt`/`caption` from the media registry, keyed by public URL. */
export type MediaMeta = Record<string, { alt?: string; caption?: string }>;

/** Read a `_settings` token as a string, or a fallback. Tolerant by design: a
 *  stored setting is untrusted JSON, and a bad token should degrade to the
 *  default rather than throw during render. */
export function setting(item: SectionItem, key: string, fallback?: string): string | undefined {
  const value = item._settings?.[key];
  return typeof value === "string" && value !== "" ? value : fallback;
}

/** Read a section field as a string (the common case for text/richText). */
export function field(item: SectionItem, key: string): string | undefined {
  const value = item[key];
  return typeof value === "string" ? value : undefined;
}

/** Read an `array` field as a list of objects, or `[]`. Stored arrays are
 *  untrusted, so a non-array or a scalar entry is dropped rather than rendered. */
export function list(item: SectionItem, key: string): Record<string, unknown>[] {
  const value = item[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v),
  );
}

/** Read a string off an array item (see {@link list}). */
export function itemField(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Alt text for an image, resolving the ASSET-LEVEL fallback.
 *
 * The precedence is the whole reason `<Sections>` does its media lookup: a
 * per-usage `alt` on the section wins, because the same photo means something
 * different in a hero than in a thumbnail strip — but when there isn't one, the
 * alt an editor typed once in the media library is used. That's what makes
 * fixing alt text a single edit that propagates everywhere the asset appears,
 * instead of a hunt through every page that embeds it.
 *
 * Returns `""` rather than undefined when neither exists: an image with no
 * description is decorative as far as a screen reader is concerned, and an
 * empty alt says exactly that. A missing attribute makes it read the filename.
 */
export function mediaAlt(
  mediaMeta: MediaMeta | undefined,
  src: string | undefined,
  override?: string,
): string {
  if (override !== undefined && override !== "") return override;
  return (src ? mediaMeta?.[src]?.alt : undefined) ?? "";
}

/** Caption for an image, same precedence as {@link mediaAlt}. Undefined when
 *  there is none — a missing caption renders nothing, unlike a missing alt. */
export function mediaCaption(
  mediaMeta: MediaMeta | undefined,
  src: string | undefined,
  override?: string,
): string | undefined {
  if (override !== undefined && override !== "") return override;
  return src ? mediaMeta?.[src]?.caption : undefined;
}

// --- The catalog -----------------------------------------------------------
// Schema only. Each entry declares what an editor can change and how it is
// validated; the matching `.astro` component owns every pixel.

/** The marketing floor: the four section types Astroid has always shipped. */
export const astroidSectionCatalog: SectionCatalog = {
  hero: {
    label: "Hero",
    icon: "hero",
    fields: {
      heading: { type: "text", label: "Heading", validation: (r) => r.required().max(120) },
      subheading: { type: "textarea", label: "Subheading" },
      // A link URL is something you can't point at on the page, so it is not
      // inline — it belongs in the inspector, which is what `inline: false` says.
      ctaLabel: { type: "text", label: "Button label" },
      ctaHref: { type: "text", label: "Button link", inline: false },
    },
    settings: SECTION_SETTINGS,
  },
  featureGrid: {
    label: "Feature grid",
    icon: "grid",
    fields: {
      heading: { type: "text", label: "Heading" },
      items: {
        type: "array",
        label: "Features",
        itemLabel: "Feature",
        itemFields: {
          title: { type: "text", label: "Title", validation: (r) => r.required() },
          body: { type: "textarea", label: "Body" },
        },
      },
    },
    settings: SECTION_SETTINGS,
  },
  cta: {
    label: "Call to action",
    icon: "cta",
    fields: {
      heading: { type: "text", label: "Heading", validation: (r) => r.required() },
      body: { type: "textarea", label: "Body" },
      ctaLabel: { type: "text", label: "Button label", validation: (r) => r.required() },
      ctaHref: { type: "text", label: "Button link", inline: false },
    },
    settings: SECTION_SETTINGS,
  },
  // --- media ---------------------------------------------------------------
  // Every `image` field is declared as such rather than as text, which is what
  // lets `collectSectionMediaUrls` find it and the page resolve alt/caption in
  // one lookup. A per-usage `alt` sits beside each one as an OVERRIDE: left
  // empty it falls back to the asset's own alt, so an editor fixes it once in
  // the media library (see `mediaAlt`).
  gallery: {
    label: "Gallery",
    icon: "gallery",
    fields: {
      heading: { type: "text", label: "Heading" },
      items: {
        type: "array",
        label: "Images",
        itemLabel: "Image",
        itemFields: {
          image: { type: "image", label: "Image" },
          alt: { type: "text", label: "Alt text (overrides the asset's)", inline: false },
          caption: { type: "text", label: "Caption" },
          href: { type: "text", label: "Links to", inline: false },
        },
      },
    },
    settings: SECTION_SETTINGS,
  },
  media: {
    label: "Media",
    icon: "image",
    fields: {
      heading: { type: "text", label: "Heading" },
      image: { type: "image", label: "Image" },
      alt: { type: "text", label: "Alt text (overrides the asset's)", inline: false },
      caption: { type: "text", label: "Caption" },
    },
    settings: SECTION_SETTINGS,
  },
  splitImage: {
    label: "Split image",
    icon: "columns",
    fields: {
      heading: { type: "text", label: "Heading", validation: (r) => r.required() },
      body: { type: "richText", label: "Body" },
      image: { type: "image", label: "Image" },
      alt: { type: "text", label: "Alt text (overrides the asset's)", inline: false },
      ctaLabel: { type: "text", label: "Button label" },
      ctaHref: { type: "text", label: "Button link", inline: false },
    },
    // Which side the image sits on is a LAYOUT, not a setting: it's a named
    // arrangement of the same content, which is exactly what `_layout` is for.
    layouts: { imageStart: { label: "Image left" }, imageEnd: { label: "Image right" } },
    settings: SECTION_SETTINGS,
  },

  // --- structured copy -----------------------------------------------------
  steps: {
    label: "Steps",
    icon: "list-ordered",
    fields: {
      heading: { type: "text", label: "Heading" },
      items: {
        type: "array",
        label: "Steps",
        itemLabel: "Step",
        itemFields: {
          title: { type: "text", label: "Title", validation: (r) => r.required() },
          body: { type: "textarea", label: "Body" },
        },
      },
    },
    settings: SECTION_SETTINGS,
  },
  banner: {
    label: "Banner",
    icon: "megaphone",
    fields: {
      text: { type: "text", label: "Text", validation: (r) => r.required().max(200) },
      ctaLabel: { type: "text", label: "Button label" },
      ctaHref: { type: "text", label: "Button link", inline: false },
    },
    settings: SECTION_SETTINGS,
  },
  faq: {
    label: "FAQ",
    icon: "help",
    fields: {
      heading: { type: "text", label: "Heading" },
      items: {
        type: "array",
        label: "Questions",
        itemLabel: "Question",
        itemFields: {
          question: { type: "text", label: "Question", validation: (r) => r.required() },
          // richText, not textarea: an answer routinely wants a link.
          answer: { type: "richText", label: "Answer" },
        },
      },
    },
    settings: SECTION_SETTINGS,
  },
  pricingTiers: {
    label: "Pricing tiers",
    icon: "tag",
    fields: {
      heading: { type: "text", label: "Heading" },
      items: {
        type: "array",
        label: "Tiers",
        itemLabel: "Tier",
        itemFields: {
          name: { type: "text", label: "Name", validation: (r) => r.required() },
          price: { type: "text", label: "Price" },
          period: { type: "text", label: "Period (e.g. /mo)" },
          // A list of strings isn't expressible — array items are objects — so
          // each feature is a one-field row. That also leaves room to add an
          // `included` flag later without a data migration.
          features: {
            type: "array",
            label: "Features",
            itemLabel: "Feature",
            itemFields: { text: { type: "text", label: "Feature" } },
          },
          ctaLabel: { type: "text", label: "Button label" },
          ctaHref: { type: "text", label: "Button link", inline: false },
          featured: {
            type: "select",
            label: "Highlight this tier",
            inline: false,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
        },
      },
    },
    settings: SECTION_SETTINGS,
  },
  testimonial: {
    label: "Testimonial",
    icon: "quote",
    fields: {
      quote: { type: "textarea", label: "Quote", validation: (r) => r.required() },
      attribution: { type: "text", label: "Who said it" },
      role: { type: "text", label: "Their role" },
      image: { type: "image", label: "Portrait" },
      alt: { type: "text", label: "Alt text (overrides the asset's)", inline: false },
    },
    settings: SECTION_SETTINGS,
  },
  aboutIntro: {
    label: "About intro",
    icon: "user",
    fields: {
      heading: { type: "text", label: "Heading", validation: (r) => r.required() },
      body: { type: "richText", label: "Body" },
      image: { type: "image", label: "Image" },
      alt: { type: "text", label: "Alt text (overrides the asset's)", inline: false },
    },
    settings: SECTION_SETTINGS,
  },

  // --- module-adjacent -----------------------------------------------------
  productGrid: {
    label: "Product grid",
    icon: "shopping-bag",
    fields: {
      heading: { type: "text", label: "Heading" },
      // Deliberately hand-authored rows rather than a live catalog read. A
      // section is stored content, and the commerce mirror is a separate
      // concern with its own loader — a site that wants the live catalog renders
      // `readCatalog` in its own page, not through the page-builder.
      items: {
        type: "array",
        label: "Products",
        itemLabel: "Product",
        itemFields: {
          name: { type: "text", label: "Name", validation: (r) => r.required() },
          price: { type: "text", label: "Price" },
          image: { type: "image", label: "Image" },
          alt: { type: "text", label: "Alt text (overrides the asset's)", inline: false },
          href: { type: "text", label: "Links to", inline: false },
        },
      },
    },
    settings: SECTION_SETTINGS,
  },
  locationHours: {
    label: "Location & hours",
    icon: "map-pin",
    fields: {
      heading: { type: "text", label: "Heading" },
      address: { type: "textarea", label: "Address" },
      phone: { type: "text", label: "Phone" },
      items: {
        type: "array",
        label: "Hours",
        itemLabel: "Day",
        itemFields: {
          day: { type: "text", label: "Day", validation: (r) => r.required() },
          hours: { type: "text", label: "Hours" },
        },
      },
    },
    settings: SECTION_SETTINGS,
  },

  contact: {
    label: "Contact",
    icon: "mail",
    fields: {
      heading: { type: "text", label: "Heading" },
      blurb: { type: "textarea", label: "Blurb" },
    },
    settings: SECTION_SETTINGS,
  },
};

/** The `_type`s with a shipped render component — derived from the catalog, so
 *  it can't drift from what `<Section>` actually dispatches. */
export type RenderableSectionType = keyof typeof astroidSectionCatalog & string;

/**
 * Does this `_type` have a shipped component? Narrows the untrusted `_type` of a
 * stored item, so `<Sections>` can skip an unknown one instead of rendering a
 * hole. (Unknown types are legitimate mid-migration, and `validateSections`
 * already rejects them on write.)
 */
export function isRenderableSection(type: string): type is RenderableSectionType {
  return Object.hasOwn(astroidSectionCatalog, type);
}
