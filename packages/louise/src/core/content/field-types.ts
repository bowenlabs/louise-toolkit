// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The field-type registry (ADR 0010, Phase A2 — epic #341, slice #342).
//
// One registration per field type, replacing the places a type used to be spelled
// out separately: the `SectionFieldType` union, the validator's if/else ladder,
// and the hardcoded inline-vs-inspector list — which `describe-node.ts` had
// already been forced to duplicate, because it needed the same answer to decide
// whether a node gets a wrench.
//
// ## Why the editor isn't here
//
// ADR 0010 sketches `defineFieldType({ name, validate, editor, inline, options? })`
// — one call carrying its own editor component. That cannot survive the boundary
// this module sits on. `core/content` is deliberately server-safe: `sections.ts`
// won't even import the `./validation.js` barrel, because that half pulls in
// `drizzle-orm` and would drag an optional peer into every consumer. Astroid
// imports this graph from `schema/collections.ts`, inside a Worker.
//
// A Solid component in these objects would put the client framework in that
// bundle. So the split is by what each side can actually hold:
//
//   • here — the SCHEMA facts: does it validate, is it edited in place. Both the
//     server validator and the client read them, so they cannot disagree.
//   • the client — the editor control, keyed by the names below. It can't invent
//     a type the schema doesn't know, and a type with no bespoke control falls
//     back to the scalar input.
//
// A plain type is one registration; one with a bespoke control is two. Against
// five before, and the "two parallel systems" the ADR measured collapse into a
// single list of names.

import type { ValidationViolation } from "../errors.js";
// Type-only, so the cycle with sections.ts is erased at build: that module owns
// the authoring shape, this one owns what each `type` in it MEANS.
import type { SectionField } from "./sections.js";

/** What a validator is told about the value it's checking. */
export interface FieldValidateContext {
  /** The field's own definition — `select` reads `options`, and a custom type can
   *  read whatever it declared. */
  field: SectionField;
  /** Dotted path to this value, for the violation message. */
  path: string;
  /** Public media base, when the caller wants `image` values confined to the
   *  media library. Absent means "don't check origin". */
  mediaBase?: string;
}

/**
 * One field type. `validate` returns violations for a stored value; returning
 * nothing means the value is acceptable.
 *
 * A validator sees the value only when it is present — `undefined` and `null` are
 * filtered out by {@link validateFieldType}, because "is this field required" is
 * the `validation` rule chain's job, not the type's. Every type would otherwise
 * repeat the same two guards, and one of them would eventually forget.
 */
export interface FieldTypeDef {
  name: string;
  /**
   * Edited in place on the bespoke render (a visible text node) rather than in
   * the inspector. A field may override it — a heading rendered as an image's alt
   * text has no node to click — but this is the default the type carries.
   */
  inline: boolean;
  /** Check a present value. Omit for a type whose shape is structural and checked
   *  by the caller (`array` recurses into its items). */
  validate?: (value: unknown, ctx: FieldValidateContext) => ValidationViolation[] | undefined;
}

const registry = new Map<string, FieldTypeDef>();

/** Register a field type, returning it so a caller can hold onto the definition
 *  (a test restoring a built-in it replaced, say). The built-ins below call this
 *  for its effect alone.
 *
 *  Re-registering a name replaces it — a site may sharpen a built-in's validation
 *  without forking the catalog. */
export function defineFieldType(def: FieldTypeDef): FieldTypeDef {
  registry.set(def.name, def);
  return def;
}

/** The definition for `name`, or `undefined` for a type nothing registered. */
export function getFieldType(name: string): FieldTypeDef | undefined {
  return registry.get(name);
}

/** Every registered type name, in registration order. */
export function fieldTypeNames(): string[] {
  return [...registry.keys()];
}

/**
 * Whether a field is edited in place. The field's own `inline` wins; otherwise
 * the type decides.
 *
 * This is the single answer to a question that used to be asked in two places
 * with two copies of the same list — `sections.tsx`'s `isInline` and
 * `describe-node.ts`'s `isInlineField`. They agreed only because they were
 * written together.
 */
export function isInlineField(field: Pick<SectionField, "type" | "inline">): boolean {
  return field.inline ?? getFieldType(field.type)?.inline ?? false;
}

/**
 * Run a field type's own check. Absent values are skipped here rather than in
 * each validator, and an unregistered type is NOT an error — a catalog may name a
 * type this build doesn't know (mid-migration, or a site's own), and the field's
 * `validation` chain still runs on it.
 */
export function validateFieldType(
  value: unknown,
  ctx: FieldValidateContext,
): ValidationViolation[] {
  if (value === undefined || value === null) return [];
  return getFieldType(ctx.field.type)?.validate?.(value, ctx) ?? [];
}

/** A violation at `path`. */
const bad = (path: string, message: string): ValidationViolation[] => [
  { path, message: `${path} ${message}`, severity: "error" },
];

/** The string check text/textarea/richText share. Empty string is allowed —
 *  "cleared" is a value, and presence is the rule chain's business. */
const mustBeString = (value: unknown, { path }: FieldValidateContext) =>
  typeof value === "string" ? undefined : bad(path, "must be a string");

/** Schemes a `link` may name. Deliberately the SAME allowlist the HTML sanitizer
 *  applies to markup `href`s (`core/security/sanitize.ts`) — a destination should
 *  be no more permissive because it was typed into the inspector instead of pasted
 *  into rich text. Duplicated rather than imported to keep `core/content` free of
 *  a `core/security` dependency; the two are asserted identical in test. */
const SAFE_LINK_URL = /^(?:https?:|mailto:|\/|#|\.)/i;

/** Whether `value` is served from the media library at `base`.
 *
 *  Inlined rather than imported from `core/media/storage.ts`, on the same grounds
 *  as `SAFE_LINK_URL` above and with the same test asserting the two agree. This
 *  module is imported by the CLIENT — it's what tells the inspector whether a
 *  field is edited in place — and `isMediaUrl` sits behind ~600 lines of image
 *  byte-sniffing and dimension parsing. Registration is a module-scope side
 *  effect, so a bundler can't shake that back out: the editor would ship a JPEG
 *  header parser to answer a string-prefix question. */
const isMediaUrl = (base: string, value: string): boolean => {
  const b = base.replace(/\/$/, "");
  return b.length > 0 && value.startsWith(`${b}/`);
};

// ── The built-in types ─────────────────────────────────────────────────────

/** Plain single-line text. Edited in place. */
defineFieldType({
  name: "text",
  inline: true,
  validate: mustBeString,
});

/** Multi-line text. Edited in place, and its render keeps newlines. */
defineFieldType({
  name: "textarea",
  inline: true,
  validate: mustBeString,
});

/** Inline-editable prose, stored as sanitized HTML (the save path runs
 *  `sanitizeSectionsRichText`). Validates as a string like the two above. */
defineFieldType({
  name: "richText",
  inline: true,
  validate: mustBeString,
});

/** A repeatable list. No `validate`: its shape is structural and the caller
 *  recurses into each item's own fields, including a discriminator's variants. */
defineFieldType({
  name: "array",
  inline: false,
});

/** A media URL. With `mediaBase`, a non-empty value must be served from the media
 *  library — an external hotlink is rejected. */
defineFieldType({
  name: "image",
  inline: false,
  validate: (value, { path, mediaBase }) => {
    if (typeof value !== "string") return bad(path, "must be a string");
    if (value !== "" && mediaBase && !isMediaUrl(mediaBase, value)) {
      return bad(path, "must be an uploaded media asset, not an external URL");
    }
    return undefined;
  },
});

/**
 * A closed choice. Empty string means "cleared" — the picker's blank option,
 * which hands the decision back to the site component's own default. Anything
 * else must be a declared option.
 *
 * The type exists because the token model needs it: `_settings` and `_layout`
 * store tokens the site maps to CSS (ADR 0005 §5), and a token set is closed by
 * definition. Declared as `text`, a four-value colorway rendered a free-text box
 * and pushed the consequence of a typo all the way to render time, where the site
 * silently fell back to a default instead of the write being rejected.
 */
defineFieldType({
  name: "select",
  inline: false,
  validate: (value, { field, path }) => {
    if (value === "") return undefined;
    const allowed = (field.options ?? []).map((o) => o.value);
    if (typeof value === "string" && allowed.includes(value)) return undefined;
    return bad(
      path,
      `has an unknown value ${JSON.stringify(value)}${
        allowed.length > 0 ? ` (expected ${allowed.join(" | ")})` : ""
      }`,
    );
  },
});

/**
 * A destination. Empty means "no link yet" — the site component decides what an
 * unset CTA renders.
 *
 * The scheme check is the point of the type. A link value is rendered straight
 * into `href={…}` by the site's own component, which never passes through the
 * HTML sanitizer (that only sees rich-text markup) — so before this existed a
 * `text`-typed href could hold `javascript:alert(1)` and would validate, persist,
 * and render as a working XSS vector for every visitor.
 */
defineFieldType({
  name: "link",
  inline: false,
  validate: (value, { path }) => {
    if (value === "") return undefined;
    if (typeof value !== "string") return bad(path, "must be a string");
    if (SAFE_LINK_URL.test(value.trim())) return undefined;
    return bad(
      path,
      `must be an http(s) URL, a mailto: address, or a site path — got ${JSON.stringify(value)}`,
    );
  },
});

/** A real boolean. Deliberately strict: a stored "true"/"false" string would be
 *  truthy either way in the site render, so coercing here would turn a bad write
 *  into a wrong page rather than an error. */
defineFieldType({
  name: "toggle",
  inline: false,
  validate: (value, { path }) =>
    typeof value === "boolean" ? undefined : bad(path, "must be true or false"),
});
