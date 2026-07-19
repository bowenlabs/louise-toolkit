// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// The typed model behind the section-library primitives (ADR 0003). This is the
// part the ADR's conventions bite hardest on, and the part TypeScript actually
// checks: variant props are unions, not `string` (§1); callers describe intent
// (`colorway="brand"`) and the component owns the token→class mapping (§2); those
// unions are DERIVED from the token maps with `keyof typeof`, so the type and the
// implementation can't drift (§3); and `<Section>` is a discriminated union over
// `SectionKind`, each arm carrying its own field shape (§6).
//
// The `.astro` components consume these types. Only the marketing-floor kinds have
// components today (hero / featureGrid / cta / contact); more arms are added here
// with their component, so an unimplemented `kind` is a compile error rather than
// a blank render.
//
// Self-contained on purpose: this module ships as SOURCE (the `.astro` next to it
// import it directly), so it must not reach back into astroid's built `src/*` —
// only siblings + external packages. `SectionKind` from config.ts is therefore not
// imported here; the runtime guard takes a plain `string`.

/**
 * Colorway → daisyUI surface classes, keyed to the `Theme.colors` set
 * (brand/secondary/tertiary) plus the neutral base. The map is the single source:
 * add a colorway here and {@link Colorway} updates itself (§3).
 */
export const COLORWAY_CLASS = {
  brand: "bg-primary text-primary-content",
  secondary: "bg-secondary text-secondary-content",
  tertiary: "bg-accent text-accent-content",
  base: "bg-base-100 text-base-content",
} as const;
export type Colorway = keyof typeof COLORWAY_CLASS;

/** Content alignment → fl/text-alignment utilities. */
export const ALIGN_CLASS = {
  start: "text-start items-start",
  center: "text-center items-center",
  end: "text-end items-end",
} as const;
export type Align = keyof typeof ALIGN_CLASS;

/** Shared presentation props every section arm accepts. */
export interface SectionBase {
  /** Surface colorway — a closed set mapped to daisyUI classes, never a raw class. */
  colorway?: Colorway;
  /** Content alignment. */
  align?: Align;
}

// --- Per-kind field shapes -------------------------------------------------
// The editable content each section kind renders. Kept minimal + declarative;
// these are the fields a `sections` JSON entry carries.

export interface HeroFields {
  heading: string;
  subheading?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface FeatureGridFields {
  heading?: string;
  items: { title: string; body: string }[];
}

export interface CtaFields {
  heading: string;
  body?: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface ContactFields {
  heading?: string;
  blurb?: string;
}

/**
 * The discriminated union `<Section>` dispatches on (§6). `<Section kind="hero">`
 * requires {@link HeroFields} and rejects another kind's fields; adding a kind
 * means adding an arm here and a component to render it. Only the kinds with a
 * shipped component appear — a subset of the full {@link SectionKind} catalog.
 */
export type SectionProps =
  | (SectionBase & { kind: "hero" } & HeroFields)
  | (SectionBase & { kind: "featureGrid" } & FeatureGridFields)
  | (SectionBase & { kind: "cta" } & CtaFields)
  | (SectionBase & { kind: "contact" } & ContactFields);

/** The section kinds that currently have a section-library component — the `kind`
 *  discriminants of {@link SectionProps}, so it can't drift from the union. */
export type RenderableSectionKind = SectionProps["kind"];

/** Type guard: does this section kind have a shipped component? Narrows a plain
 *  string (a `sections` entry's `kind` at runtime) to a {@link RenderableSectionKind}. */
export function isRenderableSection(kind: string): kind is RenderableSectionKind {
  return kind === "hero" || kind === "featureGrid" || kind === "cta" || kind === "contact";
}

/** Resolve a colorway to its class string (default: neutral base). */
export function colorwayClass(colorway: Colorway = "base"): string {
  return COLORWAY_CLASS[colorway];
}

/** Resolve an alignment to its class string (default: start). */
export function alignClass(align: Align = "start"): string {
  return ALIGN_CLASS[align];
}
