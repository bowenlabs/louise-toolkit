import { describe, expect, it } from "vitest";
import {
  type FieldConfig,
  flattenDoc,
  flattenFields,
  nestDoc,
} from "../../src/core/content/types.js";

// The group-field canonicalization in core/content/types.ts (#695):
// `flattenFields` for the schema, and `flattenDoc`/`nestDoc` for the documents
// written to and read from it.

const fields: Record<string, FieldConfig> = {
  name: { type: "text" },
  address: {
    type: "group",
    fields: {
      city: { type: "text" },
      geo: { type: "group", fields: { lat: { type: "number" }, lng: { type: "number" } } },
    },
  },
  tags: { type: "array", fields: { label: { type: "text" } } },
};

describe("flattenFields", () => {
  it("expands groups into prefixed keys, recursively, and passes other fields through", () => {
    const flat = flattenFields(fields);
    expect(Object.keys(flat)).toEqual([
      "name",
      "address_city",
      "address_geo_lat",
      "address_geo_lng",
      "tags",
    ]);
    expect(flat.name).toBe(fields.name);
    expect(flat.address_geo_lat).toEqual({ type: "number" });
    // An array's nested fields describe its JSON, so they stay nested.
    expect(flat.tags).toBe(fields.tags);
  });

  it("returns an empty object for no fields, and for a group with none", () => {
    expect(flattenFields({})).toEqual({});
    expect(flattenFields({ empty: { type: "group", fields: {} } })).toEqual({});
  });
});

describe("flattenDoc", () => {
  it("flattens a nested document to its column keys", () => {
    expect(
      flattenDoc(fields, {
        name: "Alex",
        address: { city: "Springfield", geo: { lat: 1.5, lng: -2 } },
        tags: [{ label: "vip" }],
      }),
    ).toEqual({
      name: "Alex",
      address_city: "Springfield",
      address_geo_lat: 1.5,
      address_geo_lng: -2,
      tags: [{ label: "vip" }],
    });
  });

  it("omits fields and groups the document doesn't carry, for a partial update", () => {
    expect(flattenDoc(fields, { name: "Kai" })).toEqual({ name: "Kai" });
    expect(flattenDoc(fields, { address: { city: "Shelbyville" } })).toEqual({
      address_city: "Shelbyville",
    });
  });

  it("keeps an explicit undefined or null on a plain field", () => {
    expect(flattenDoc(fields, { name: undefined })).toEqual({ name: undefined });
    expect(flattenDoc(fields, { name: null })).toEqual({ name: null });
  });

  it("treats a null group as an empty one", () => {
    expect(flattenDoc(fields, { address: null })).toEqual({});
  });

  it("ignores keys that aren't fields", () => {
    expect(flattenDoc(fields, { id: 3, name: "Quinn" })).toEqual({ name: "Quinn" });
  });
});

describe("nestDoc", () => {
  it("re-nests a flat row into the config's shape", () => {
    expect(
      nestDoc(fields, {
        name: "Alex",
        address_city: "Springfield",
        address_geo_lat: 1.5,
        address_geo_lng: -2,
        tags: [],
      }),
    ).toEqual({
      name: "Alex",
      address: { city: "Springfield", geo: { lat: 1.5, lng: -2 } },
      tags: [],
    });
  });

  it("round-trips a document through flattenDoc", () => {
    const doc = {
      name: "Kai",
      address: { city: "Capital City", geo: { lat: 0, lng: 0 } },
      tags: [{ label: "new" }],
    };
    expect(nestDoc(fields, flattenDoc(fields, doc))).toEqual(doc);
  });

  it("always returns a group's object, empty when the row has none of its columns", () => {
    expect(nestDoc(fields, { name: "Quinn" })).toEqual({
      name: "Quinn",
      address: { geo: {} },
    });
  });

  it("keeps a null column and drops columns that aren't fields", () => {
    expect(nestDoc(fields, { id: 9, name: null, address_city: null })).toEqual({
      name: null,
      address: { city: null, geo: {} },
    });
  });
});
