// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { StandardSchemaV1 } from "../schema/index.js";
import type { ValidationBuilder } from "./validation.js";

/**
 * Editor-only presentation hints for a single field (issue #16 follow-on) —
 * the field-level counterpart to {@link CollectionAdminConfig}. Purely about
 * how the editor renders the field; absent → sensible defaults (a humanized
 * key for the label, no help text, full width, always shown, editable). None
 * of this touches the DB schema or the Local API.
 */
export interface FieldAdminConfig {
  /** Human-friendly label; defaults to a humanized field key (`metaDescription` → "Meta description"). */
  label?: string;
  /** Help text rendered beneath the label. */
  description?: string;
  /** Placeholder for text-like inputs. */
  placeholder?: string;
  /** Groups the field into a titled fieldset in the editor, in first-seen order. */
  group?: string;
  /** Editor column width on >= md screens. Defaults to "full". */
  width?: "full" | "half";
  /**
   * Show the field only when this predicate — given the whole in-progress
   * form value — returns true (Payload's `admin.condition`). A function, so
   * it's evaluated by the editor directly from the imported config, not from
   * a serialized meta payload.
   */
  condition?: (values: Record<string, unknown>) => boolean;
  /**
   * Create-form only (issue #98). Reactively seed this field from another
   * field's value — e.g. default a page `title` from the chosen `category`.
   * When the `field` source changes and this field is still *pristine* (empty,
   * or still holding the value we last seeded — i.e. the user hasn't typed
   * their own), this field is set to `map({ value, label })`. For a
   * `relationship` source, `label` is the selected option's label, and `map`
   * defaults to `label ?? value` when omitted. Overridable: a value the user
   * has typed is never clobbered. Ignored on the edit form (real data wins).
   */
  defaultFrom?: {
    field: string;
    map?: (source: { value: unknown; label?: string }) => unknown;
  };
  /**
   * Create-form only (issue #98). **Array fields only.** When creating a new
   * row and `when(values)` holds, append `item(values)` to this array before
   * submit — lets a "template" create-flow auto-insert a builder block
   * bound to another field (e.g. push a `portfolioGallery` block bound to the
   * chosen `category` into `blocks`). Runs once at submit; never on edit.
   */
  appendOnCreate?: {
    when?: (values: Record<string, unknown>) => boolean;
    item: (values: Record<string, unknown>) => Record<string, unknown>;
  };
  /** Render the field read-only in the editor. */
  readOnly?: boolean;
}

export interface BaseFieldConfig {
  /** column name override; defaults to the config key */
  name?: string;
  required?: boolean;
  unique?: boolean;
  defaultValue?: unknown;
  /** Editor-only presentation hints — see {@link FieldAdminConfig}. */
  admin?: FieldAdminConfig;
  /**
   * Chainable validation rules (issue #16), Sanity's `defineField`
   * `validation` analogue: `validation: (rule) => rule.required().min(2)`.
   * Evaluated server-side by createLocalApi on every create/update (and by
   * the editor for client-side feedback). Independent of the `required`/
   * `unique` flags above — those still drive the DB schema; these drive
   * value-level checks with clear, per-field error messages. See
   * {@link ValidationBuilder} and `validation.ts`.
   */
  validation?: ValidationBuilder;
  /**
   * Bring-your-own validation (#98): any Standard Schema
   * (https://standardschema.dev) — Zod, Valibot, ArkType, or the built-in
   * `louise-toolkit/schema` `s.*` builder. Evaluated by `validateDocument`
   * alongside the `validation` chain, on the field's (flattened) value, and
   * skipped when the value is empty so it doesn't double up with `required`.
   * The zero-dep `Rule` engine stays the default; this lets a consumer reuse a
   * validator they already maintain.
   */
  schema?: StandardSchemaV1;
}

export interface TextFieldConfig extends BaseFieldConfig {
  type: "text";
  defaultValue?: string;
}

export interface SelectFieldConfig<TOption extends string = string> extends BaseFieldConfig {
  type: "select";
  options: readonly TOption[];
  defaultValue?: TOption;
}

export interface NumberFieldConfig extends BaseFieldConfig {
  type: "number";
  /** marks this field as the table's auto-incrementing primary key */
  autoIncrement?: boolean;
  defaultValue?: number;
}

export interface DateFieldConfig extends BaseFieldConfig {
  type: "date";
  /** mirrors drizzle's integer(..., { mode: "timestamp" | "timestamp_ms" }) */
  mode?: "timestamp" | "timestamp_ms";
  defaultValue?: "now" | Date;
  /**
   * `"now"` stamps the column with the current time on every write that runs
   * through the Local API's `update()` / versioned `publish()` (drizzle's
   * `$onUpdateFn`) — the standard `updatedAt` pattern. Pair with
   * `defaultValue: "now"` so the column is also set on insert.
   */
  onUpdate?: "now";
}

// Full field-type matrix from issue #16. All six are implemented in
// codegen.ts: richText/array → JSON column, upload → text column,
// relationship → integer column (hasMany:false) or join table
// (hasMany:true), checkbox → integer column with drizzle's boolean mode.
export interface RichTextFieldConfig extends BaseFieldConfig {
  type: "richText";
}

/**
 * The TS type every JSON-mode column (`richText`/`array` fields,
 * `versionData`) is given via drizzle's `.$type<JsonValue>()` — see
 * codegen.ts's and schema-gen.ts's richText/array cases. Without it,
 * drizzle infers a JSON column as `unknown`, which TanStack Start's
 * server-function return-type validator rejects outright (`unknown`
 * doesn't structurally match its `Serializable` check the way a plain
 * object/array/primitive union does). Recursive on purpose — that's what
 * lets the validator recurse through it instead of bottoming out at
 * `unknown`.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CheckboxFieldConfig extends BaseFieldConfig {
  type: "checkbox";
  defaultValue?: boolean;
}

export interface RelationshipFieldConfig extends BaseFieldConfig {
  type: "relationship";
  relationTo: string;
  /**
   * `false` (default): a plain integer column on this collection's own
   * table storing the related row's id.
   * `true`: no column on this table — represented by a generated join
   * table instead (see codegen.ts's relationshipJoinTables).
   */
  hasMany?: boolean;
}

/**
 * `0` (default): a relationship field's column comes back as the bare
 * related-row id. `1`: `createLocalApi`'s `registry` param is used to
 * batch-resolve `hasMany: false` relationship fields into the related
 * row's full document — see localApi.ts's `resolveRelationships`. Depths
 * beyond 1 (resolving a relationship's own relationships) aren't
 * implemented; there's no nested-relationship fixture yet to validate
 * that design against.
 */
export type RelationshipDepth = 0 | 1;

export interface ArrayFieldConfig extends BaseFieldConfig {
  type: "array";
  /**
   * Fields shown for every item, regardless of variant — must include
   * `discriminator.key`'s own field (typically a `select`) if set.
   */
  fields: Record<string, FieldConfig>;
  /**
   * Lets one array field model a union of item shapes (e.g. builder
   * blocks: image vs hero vs richText vs...) instead of one fixed field
   * set for every item. `key` names a field already present in `fields`
   * (rendered as the item's type switcher); `variants` maps each of that
   * field's possible values to *additional* fields layered on top, shown
   * only for items whose `key` field currently holds that value. Fields
   * not listed under any variant (i.e. everything in `fields`) render
   * unconditionally — that's the place for fields shared across every
   * variant (e.g. a `caption` every block type has).
   *
   * Storage is unaffected either way — `array` is always one JSON column
   * (see codegen.ts); this only changes what `CollectionEdit` renders.
   */
  discriminator?: {
    key: string;
    variants: Record<string, Record<string, FieldConfig>>;
    /**
     * Optional per-variant presentation for the editor's "Add block" picker
     * (the visual block builder). `label` defaults to a humanized variant
     * name; `icon` is an opaque CSS class the editor applies to an `<i>`
     * (e.g. a Phosphor `"ph ph-image"`), keeping louise-admin(legacy) icon-library-agnostic.
     */
    variantsAdmin?: Record<string, { label?: string; icon?: string }>;
  };
}

export interface UploadFieldConfig extends BaseFieldConfig {
  type: "upload";
  defaultValue?: string;
}

/**
 * A freeform JSON-blob column — the `json` field type. Storage-identical to
 * `richText`/`array` (one `.$type<JsonValue>()` text column, see
 * codegen.ts's `fieldToColumn`) but with no TipTap/array-item connotation —
 * use this for genuinely unstructured data (webhook audit payloads, CRM
 * activity metadata), not builder content.
 */
export interface JsonFieldConfig extends BaseFieldConfig {
  type: "json";
  defaultValue?: JsonValue;
}

/**
 * A fixed-shape, queryable sub-object — the `group` field type from Section
 * 3. Unlike `array` (JSON-blob storage, variable length), `group` flattens
 * to real prefixed columns at the Drizzle level (`<key>_<subKey>`, see
 * codegen.ts's `collectionToTable` and `flattenFields` below) so SQL-level
 * querying/sorting on a subfield (e.g. `shippingAddress.city`) still works.
 * `required`/`unique`/`defaultValue` on the group itself are meaningless —
 * set them on the individual nested `fields` instead; codegen ignores them
 * at the group level.
 */
export interface GroupFieldConfig extends BaseFieldConfig {
  type: "group";
  fields: Record<string, FieldConfig>;
}

export type FieldConfig =
  | TextFieldConfig
  | SelectFieldConfig
  | NumberFieldConfig
  | DateFieldConfig
  | RichTextFieldConfig
  | CheckboxFieldConfig
  | RelationshipFieldConfig
  | ArrayFieldConfig
  | UploadFieldConfig
  | JsonFieldConfig
  | GroupFieldConfig;

/**
 * Expands every `group` field in `fields` into its flattened equivalents
 * (`<key>_<subKey>`, recursively — a group nested inside a group flattens
 * all the way down), and passes every other field through unchanged. This
 * is the single canonicalization step codegen, schema-gen, and the Local
 * API's field-shape validation (`validateRequiredFields`/
 * `rejectUnknownFields`) all run before touching `group` fields, so none of
 * them need their own group-aware branch — see localApi.ts's `flattenDoc`/
 * `nestDoc` for the matching document-level transform.
 *
 * Known limitation: a flattened key can collide if two different group
 * nestings produce the same combined name (e.g. a group `a_b` containing
 * field `c` collides with group `a` containing field `b_c`) — not guarded
 * against, since no current collection nests groups deeply enough to hit
 * it.
 */
export function flattenFields(fields: Record<string, FieldConfig>): Record<string, FieldConfig> {
  const result: Record<string, FieldConfig> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "group") {
      for (const [subKey, subField] of Object.entries(flattenFields(field.fields))) {
        result[`${key}_${subKey}`] = subField;
      }
    } else {
      result[key] = field;
    }
  }
  return result;
}

/**
 * The document-level counterpart to `flattenFields` — turns a `group`
 * field's nested object value (`{ shippingAddress: { city: "..." } }`) into
 * its flattened equivalent (`{ shippingAddress_city: "..." }`) for writing
 * to the DB, recursively. Fields not present in `doc` are simply omitted
 * from the result (lets `update()`'s partial inputs flatten correctly —
 * an absent group means every one of its flattened keys is absent too, not
 * `undefined`-valued). See `nestDoc` for the inverse, used on read.
 */
export function flattenDoc(
  fields: Record<string, FieldConfig>,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "group") {
      if (!(key in doc)) continue;
      const nested = (doc[key] ?? {}) as Record<string, unknown>;
      for (const [subKey, subValue] of Object.entries(flattenDoc(field.fields, nested))) {
        result[`${key}_${subKey}`] = subValue;
      }
    } else if (key in doc) {
      result[key] = doc[key];
    }
  }
  return result;
}

/**
 * The inverse of `flattenDoc` — re-nests a flat DB row's `<key>_<subKey>`
 * columns back into `{ key: { subKey: ... } }` for everything the Local
 * API returns to a caller, so a `group` field's document shape always
 * matches its config shape regardless of how it's actually stored.
 */
export function nestDoc(
  fields: Record<string, FieldConfig>,
  flatRow: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "group") {
      const prefix = `${key}_`;
      const nestedFlat: Record<string, unknown> = {};
      for (const [flatKey, value] of Object.entries(flatRow)) {
        if (flatKey.startsWith(prefix)) {
          nestedFlat[flatKey.slice(prefix.length)] = value;
        }
      }
      result[key] = nestDoc(field.fields, nestedFlat);
    } else if (key in flatRow) {
      result[key] = flatRow[key];
    }
  }
  return result;
}

/**
 * Per-operation access check, modeled on Payload's own `access` shape.
 * @returns whether the operation is allowed. Implementations decide their
 * own context shape (auth/session info isn't standardized by Louise) — see
 * {@link LocalApi}'s `TContext` generic, which every operation now requires
 * a value for.
 *
 * Enforced by `createLocalApi` since Section 2 — see
 * {@link CollectionConfig.access}.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- the context shape is intentionally caller-defined; Louise doesn't standardize auth/session info
export type AccessFn<TContext = any> = (context: TContext) => boolean | Promise<boolean>;

export interface CollectionAccess {
  create?: AccessFn;
  read?: AccessFn;
  update?: AccessFn;
  delete?: AccessFn;
  /**
   * Gates `VersionedLocalApi.publish`/`unpublish` (see createVersionedLocalApi
   * in localApi.ts). Separate from `update` — publishing is a distinct
   * privilege from editing a draft, matching Payload's own model.
   */
  publish?: AccessFn;
}

/**
 * Lifecycle hooks, modeled on Payload's own hook points. Each is an
 * ordered array, run in sequence. Enforced by `createLocalApi` — see
 * {@link CollectionConfig.hooks}.
 */
export interface CollectionHooks<TDoc = Record<string, unknown>> {
  beforeChange?: Array<(args: { data: Partial<TDoc> }) => Partial<TDoc> | Promise<Partial<TDoc>>>;
  /**
   * `operation` distinguishes a freshly-inserted doc from an edited one —
   * `publish()` (versioned collections) counts as `"update"`, since it
   * writes to an already-existing row rather than creating one. Lets
   * webhook config (see `content/webhooks.ts`) filter which events it fires
   * on without the hook itself tracking state.
   */
  afterChange?: Array<
    (args: { doc: TDoc; operation: "create" | "update" }) => void | Promise<void>
  >;
  beforeRead?: Array<(args: { doc: TDoc }) => TDoc | Promise<TDoc>>;
  afterRead?: Array<(args: { doc: TDoc }) => TDoc | Promise<TDoc>>;
  beforeDelete?: Array<(args: { id: number }) => void | Promise<void>>;
  afterDelete?: Array<(args: { id: number }) => void | Promise<void>>;
}

/**
 * Editor-presentation hints for a collection, modeled on Sanity's Structure
 * Builder (`sanity/structure`). Purely about how the admin sidebar/editor
 * *presents* a collection — never affects the DB schema, the Local API, or
 * access control. Consumed by {@link buildEditorStructure} (see
 * `structure.ts`); a collection with no `admin` block falls back to sensible
 * defaults (visible, editable, listed, grouped under the default group,
 * label = capitalized slug). Plugin-injected collections can't carry an
 * `admin` block in hand-written config, so `buildEditorStructure` also
 * accepts per-slug overrides at the call site — see its `overrides` option.
 */
export interface CollectionAdminConfig {
  /**
   * Sidebar group heading this collection appears under (e.g. "Content",
   * "Store"). Collections without a group fall into the builder's default
   * group. Decoupling nav grouping from the raw collection list is the whole
   * point of the Structure Builder.
   */
  group?: string;
  /**
   * Sort order within a group — lower sorts first. Ties (and the absence of
   * an explicit order) break by the collection's position in the config
   * array, so config order is the stable default.
   */
  order?: number;
  /**
   * Drop this collection from the sidebar entirely. For pure system/log
   * tables a human never browses (e.g. `webhook_events`).
   */
  hidden?: boolean;
  /**
   * Mark as read-only in the editor — still navigable/viewable, but the UI
   * suppresses create/edit/delete affordances. For machine-written tables a
   * human should inspect but never edit (e.g. `payments`).
   */
  readOnly?: boolean;
  /**
   * Singleton: exactly one document. The sidebar links straight to its
   * editor (`/admin/<slug>`) instead of a list-then-create flow — Sanity's
   * singleton-document structure pattern. (Storage is unchanged; this only
   * changes navigation.)
   */
  singleton?: boolean;
  /** Display label override; defaults to a capitalized slug. */
  label?: string;
  /**
   * Optional icon identifier passed through to the sidebar renderer (e.g. a
   * Phosphor icon name). The builder treats it as an opaque string.
   */
  icon?: string;
}

export interface CollectionConfig {
  /** table name in D1; also the Local API's collection slug (later step) */
  slug: string;
  fields: Record<string, FieldConfig>;
  /**
   * Per-operation access control, enforced by `createLocalApi` (Section 2).
   * Reserved per issue #16 step 7 ("reserve typed config keys now,
   * implementation deferred to Section 2+") — that deferral is over: every
   * `LocalApi` method now requires a `context` argument and runs the
   * matching access function (`read` for `find`/`findByID`, `create` for
   * `create`, etc.) before touching the database. No access function
   * configured for an operation means that operation is unconditionally
   * allowed, matching the pre-enforcement default.
   */
  access?: CollectionAccess;
  /** Lifecycle hooks, enforced by `createLocalApi`. See {@link CollectionHooks}. */
  hooks?: CollectionHooks;
  /**
   * Opts this collection into draft/version history. When `drafts` is
   * true, codegen (see codegen.ts/schema-gen.ts) generates a companion
   * `${slug}_versions` table and a nullable `published_version_id` pointer
   * column on the main table, and `createVersionedLocalApi` (localApi.ts)
   * becomes usable against it. Collections without this stay exactly as
   * before — no versions table, no extra column, only `createLocalApi`.
   */
  versions?: {
    drafts?: boolean;
    /** Reserved for future pruning of old versions; not enforced yet. */
    maxPerDoc?: number;
  };
  /**
   * Opts this collection into full-text search (issue #29). `fields` names
   * which of this collection's own `text`/`richText`/`upload` fields are
   * indexed — `defineContentConfig`/`defineCollection` reject any other field
   * type or an unknown key. When set, codegen (see codegen.ts's
   * `collectionSearchTableSQL`) describes a companion `${slug}_fts` SQLite
   * FTS5 virtual table, and `createLocalApi` both becomes able to run
   * `.search()` and keeps that table in sync on every create/update/delete
   * — see localApi.ts's `syncSearchIndex`. `richText` fields are flattened
   * to plain text (TipTap JSON's `text` leaves, concatenated) before being
   * indexed; nested `array`/block content is out of scope for this phase.
   */
  search?: {
    fields: readonly string[];
  };
  /**
   * Editor-presentation hints — grouping, ordering, hidden/read-only,
   * singleton, label, icon. Consumed only by {@link buildEditorStructure}
   * (the Structure Builder); never affects schema, Local API, or access.
   * See {@link CollectionAdminConfig}.
   */
  admin?: CollectionAdminConfig;
}

/**
 * A Louise plugin — a synchronous transform over the whole content config,
 * modeled on Payload's `plugins: [(config) => config]` shape. A plugin may
 * add or modify collections, inject fields, or register lifecycle hooks.
 * `defineContentConfig` runs plugins in array order, each receiving the output
 * of the previous one, *before* validation — so a plugin's output is held
 * to the same rules as a hand-written config.
 *
 * Synchronous in Section 2 by design: the resolved config is consumed by
 * schema codegen and runtime config loading, both of which are sync. An
 * async variant is a deliberate later extension, not an oversight.
 */
export type LouisePlugin = (config: ContentConfig) => ContentConfig;

export interface ContentConfig {
  collections: CollectionConfig[];
  /**
   * Config transforms run in order by `defineContentConfig` before validation.
   * See {@link LouisePlugin}. Omit for a plain, plugin-free config.
   */
  plugins?: LouisePlugin[];
}
