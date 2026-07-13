// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import { LouiseContentError } from "../errors.js";
import type { ContentConfig, CollectionConfig, FieldConfig } from "./types.js";

const KNOWN_FIELD_TYPES: ReadonlySet<FieldConfig["type"]> = new Set([
  "text",
  "select",
  "number",
  "date",
  "richText",
  "checkbox",
  "relationship",
  "array",
  "upload",
  "json",
  "group",
]);

// Validates one field's own shape (type known, relationship/array/group
// invariants) without descending into a collection's broader rules
// (search.fields etc, which only make sense at the top level). Recurses
// into `group`'s nested fields so a group can't smuggle in an unrecognized
// or malformed nested field — same checks, one level down.
function validateField(slug: string, key: string, field: FieldConfig): void {
  if (!KNOWN_FIELD_TYPES.has(field.type)) {
    throw new LouiseContentError(
      `Collection "${slug}" field "${key}" has unrecognized type "${field.type}"`,
    );
  }

  if (field.type === "relationship" && !field.relationTo) {
    throw new LouiseContentError(
      `Collection "${slug}" field "${key}" is a relationship field and requires "relationTo"`,
    );
  }

  if (field.type === "array" && Object.keys(field.fields ?? {}).length === 0) {
    throw new LouiseContentError(
      `Collection "${slug}" field "${key}" is an array field and must define at least one nested field`,
    );
  }

  if (field.type === "group") {
    const nestedEntries = Object.entries(field.fields ?? {});
    if (nestedEntries.length === 0) {
      throw new LouiseContentError(
        `Collection "${slug}" field "${key}" is a group field and must define at least one nested field`,
      );
    }
    for (const [nestedKey, nestedField] of nestedEntries) {
      validateField(slug, `${key}.${nestedKey}`, nestedField);
    }
  }
}

function validateCollectionConfig(config: CollectionConfig): void {
  if (!config.slug || config.slug.trim().length === 0) {
    throw new LouiseContentError("Collection config requires a non-empty slug");
  }

  const fieldEntries = Object.entries(config.fields ?? {});
  if (fieldEntries.length === 0) {
    throw new LouiseContentError(`Collection "${config.slug}" must define at least one field`);
  }

  for (const [key, field] of fieldEntries) {
    validateField(config.slug, key, field);
  }

  const SEARCHABLE_FIELD_TYPES: ReadonlySet<FieldConfig["type"]> = new Set([
    "text",
    "richText",
    "upload",
    // `json` (and array-of-block content stored as json) is indexed by flattening
    // every string leaf to plain text — see codegen's `extractSearchText`.
    "json",
  ]);
  for (const key of config.search?.fields ?? []) {
    const field = config.fields[key];
    if (!field) {
      throw new LouiseContentError(
        `Collection "${config.slug}" search.fields references unknown field "${key}"`,
      );
    }
    if (!SEARCHABLE_FIELD_TYPES.has(field.type)) {
      throw new LouiseContentError(
        `Collection "${config.slug}" search.fields field "${key}" has type "${field.type}" — only "text", "richText", and "upload" fields can be indexed`,
      );
    }
  }
}

function validateUniqueSlugs(collections: readonly CollectionConfig[]): void {
  const seen = new Set<string>();
  for (const collection of collections) {
    if (seen.has(collection.slug)) {
      throw new LouiseContentError(
        `Duplicate collection slug "${collection.slug}" — collection slugs must be unique`,
      );
    }
    seen.add(collection.slug);
  }
}

export function defineCollection(config: CollectionConfig): CollectionConfig {
  validateCollectionConfig(config);
  return config;
}

export function defineContentConfig(config: ContentConfig): ContentConfig {
  // Run plugins in array order, each fed the previous one's output, before
  // any validation — a plugin's emitted config is held to exactly the same
  // rules as a hand-written one. The resolved config (not the raw input) is
  // what every downstream consumer reads: schema codegen, admin meta, and
  // the Local API. Plugins must not mutate their input; treat `config` as
  // immutable and return a new object (the SEO plugin does this).
  let resolved: ContentConfig = config;
  for (const plugin of config.plugins ?? []) {
    resolved = plugin(resolved);
  }

  for (const collection of resolved.collections) {
    validateCollectionConfig(collection);
  }
  validateUniqueSlugs(resolved.collections);
  return resolved;
}
