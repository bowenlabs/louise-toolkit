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

import type { SectionKind } from "../config.js";

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

/** The `SectionKind`s that currently have a section-library component. A compile
 *  error here if one drifts from `SectionProps` above. */
export type RenderableSectionKind = SectionProps["kind"];

/** Type guard: does this `SectionKind` have a shipped component? */
export function isRenderableSection(kind: SectionKind): kind is RenderableSectionKind {
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
