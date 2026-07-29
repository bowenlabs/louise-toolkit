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

/** One choice in a closed set. `label` is what the editor reads; `value` is what
 *  is stored — a token differs from its presentation for the usual reason. */
export interface FieldOption {
  value: string;
  label?: string;
}

/**
 * Choices fetched at edit time rather than declared in the catalog.
 *
 * The reason this exists is ADR 0010's: a picker whose choices come from an API —
 * Square locations, a product catalog — could not be expressed at all. `options`
 * took a literal array, so the only way to build one was the settings drawer's
 * `render` escape hatch, which the section inspector doesn't have.
 *
 * Called with no arguments: a resolver is declared in the site's catalog module
 * and closes over whatever config it needs, so nothing has to be threaded through
 * the schema layer to reach it.
 */
export type FieldOptionsResolver = () => Promise<FieldOption[]>;

/** Either a literal set of choices or something that fetches them. */
export type FieldOptions = FieldOption[] | FieldOptionsResolver;

/** Whether `options` fetches its choices rather than declaring them. */
export function isOptionsResolver(
  options: FieldOptions | undefined,
): options is FieldOptionsResolver {
  return typeof options === "function";
}

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
 * The names a field may declare: every built-in, plus any string.
 *
 * The `(string & {})` arm is what makes a site's own `defineFieldType` actually
 * usable. A closed union is checkable but not extensible, and slice 1 hit the
 * wall: a type registered at runtime widened the registry and not the type a
 * catalog could write, so the test that proved "one registration is enough" had
 * to reach for a cast.
 *
 * The intersection is the standard trick for keeping both — TypeScript won't
 * collapse the union to `string`, so editors still complete the ten built-ins,
 * while a registered name type-checks. What's lost is the typo check: `"txet"` is
 * now legal to write, and an unregistered type validates as nothing rather than
 * failing — which is why {@link unknownFieldTypes} exists for a catalog that
 * wants the stricter guarantee back.
 */
export type FieldTypeName =
  | "text"
  | "textarea"
  | "richText"
  | "array"
  | "image"
  | "select"
  | "link"
  | "toggle"
  | "color"
  | "links"
  // biome-ignore lint/suspicious/noEmptyBlockStatements: the `string & {}` idiom
  // preserves literal completion; `string` alone would swallow the union.
  | (string & {});

/**
 * Every field type named in `defs` that nothing has registered.
 *
 * The escape hatch for what the widened {@link FieldTypeName} gives up. A site
 * that registers its own types but still wants a typo to fail early calls this
 * over its catalog at boot: it is the check the closed union used to perform, now
 * opt-in and covering site-defined types too — which the union never could.
 */
export function unknownFieldTypes(defs: Iterable<{ type: string }>): string[] {
  const missing = new Set<string>();
  for (const def of defs) if (!registry.has(def.type)) missing.add(def.type);
  return [...missing];
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

/**
 * Whether `value` is a destination Louise will store and a site may render into
 * an `href`.
 *
 * Exported because a stored destination is not only a section field: site
 * settings hold `navLinks` / `socialLinks`, rendered into the site chrome on
 * every page. Nothing checked those until an editor could have planted
 * `javascript:` in one — so the two paths now share a predicate rather than a
 * convention.
 *
 * Empty is safe: "no link yet" is a value, and what an unset link renders is the
 * site component's decision.
 */
export function isSafeLinkUrl(value: unknown): boolean {
  if (typeof value !== "string" || value === "") return true;
  return SAFE_LINK_URL.test(value.trim());
}

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
    // A RESOLVED option set is deliberately not checked here. Doing so would mean
    // a network call on the write path — a page save failing because Square is
    // down is a worse failure than an unrecognised token, and it hands an
    // external service the ability to block publishing. The value is still checked
    // as a string, and a field that wants the closed-set guarantee back declares
    // it with its own `validation` chain.
    //
    // Phase B is where this gets a real answer: an `external` source is MIRRORED
    // by definition (ADR 0010), and a local mirror is something the write path can
    // check without leaving the Worker.
    if (isOptionsResolver(field.options)) {
      return typeof value === "string" ? undefined : bad(path, "must be a string");
    }
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

// ── Types the settings drawer had and sections didn't ──────────────────────
// The two systems overlapped on text/textarea/image/toggle and diverged on the
// rest, so a type added to one was silently missing from the other. These two
// were settings-only; `richText` / `array` / `select` / `link` were sections-only
// and are above. One list now, so "which surface is this for" stops being a
// property of the type.

/** A CSS colour. Free-form, unlike `select` — a brand colour is picked, not
 *  chosen from a closed set, which is exactly why a token `select` couldn't serve
 *  and the drawer needed its own type.
 *
 *  Validated loosely on purpose: hex, `rgb()`, `hsl()`, and named colours are all
 *  legitimate, and the value is only ever written into a CSS custom property. The
 *  check that matters is that it can't carry markup or a URL. */
defineFieldType({
  name: "color",
  inline: false,
  validate: (value, { path }) => {
    if (typeof value !== "string") return bad(path, "must be a string");
    if (value === "" || /^[\w#(),.%\s/-]+$/.test(value)) return undefined;
    return bad(path, `must be a CSS colour — got ${JSON.stringify(value)}`);
  },
});

/**
 * An ordered list of `{ label, href }` rows — nav links, social links, footer
 * CTAs.
 *
 * Structurally this is an `array` whose items are a `text` and a `link`, and
 * modelling it that way is the eventual end state. It stays its own type for now
 * because the drawer's editor for it is a bespoke row list with add/remove/reorder,
 * and because the shape is fixed rather than author-declared.
 *
 * The `href` check is the one that matters: these render into the site's chrome
 * on every page, and until the XSS fix nothing validated them.
 */
defineFieldType({
  name: "links",
  inline: false,
  validate: (value, { path }) => {
    if (!Array.isArray(value)) return bad(path, "must be an array of links");
    const out: ValidationViolation[] = [];
    value.forEach((row, i) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        out.push(...bad(`${path}[${i}]`, "must be an object"));
        return;
      }
      const { href, label } = row as Record<string, unknown>;
      if (label !== undefined && typeof label !== "string") {
        out.push(...bad(`${path}[${i}].label`, "must be a string"));
      }
      if (!isSafeLinkUrl(href)) {
        out.push(
          ...bad(
            `${path}[${i}].href`,
            `must be an http(s) URL, a mailto: address, or a site path — got ${JSON.stringify(href)}`,
          ),
        );
      }
    });
    return out.length > 0 ? out : undefined;
  },
});
