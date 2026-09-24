import { describe, expect, it } from "vitest";
import { collectionVersionsTable, defineCollection } from "../../src/core/content/index.js";
import {
  type DraftBufferKV,
  draftBufferKey,
  latestPendingDraft,
  resumeDraft,
  writeDraftBuffer,
} from "../../src/core/editor/index.js";

const config = defineCollection({
  slug: "pages",
  fields: { title: { type: "text" }, sections: { type: "json" }, body: { type: "richText" } },
  versions: { drafts: true },
});
const versionsTable = collectionVersionsTable(config);

interface Version {
  id: number;
  parentId: number;
  status: "draft" | "published";
  versionData: unknown;
}

/**
 * A D1 stand-in that records each statement and answers the resume query by
 * actually applying its binds to `versions`—so the test checks behaviour
 * (which row comes back), not just a SQL string. The bind order is what
 * drizzle emits for this query: parentId, status, [publishedVersionId], limit.
 */
function fakeD1(versions: Version[]) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          const [parentId, status, ...rest] = params;
          const floor = rest.length > 1 ? (rest[0] as number) : null;
          const match = versions
            .filter(
              (v) =>
                v.parentId === parentId && v.status === status && (floor === null || v.id > floor),
            )
            .sort((a, b) => b.id - a.id)
            .slice(0, 1);
          const rows = match.map((v) => [JSON.stringify(v.versionData)]);
          return {
            raw: async () => rows,
            all: async () => ({ results: rows }),
          };
        },
      };
    },
  } as unknown as D1Database;
  return { d1, statements };
}

function memoryKv(): DraftBufferKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
  };
}

const VERSIONS: Version[] = [
  { id: 3, parentId: 7, status: "draft", versionData: { title: "superseded" } },
  { id: 5, parentId: 7, status: "published", versionData: { title: "live" } },
  { id: 8, parentId: 7, status: "draft", versionData: { title: "older pending" } },
  { id: 9, parentId: 7, status: "draft", versionData: { title: "newest pending", sections: [] } },
  { id: 10, parentId: 99, status: "draft", versionData: { title: "another page" } },
];

describe("resumeDraft", () => {
  it("returns the newest draft newer than the live pointer", async () => {
    const { d1 } = fakeD1(VERSIONS);
    const draft = await resumeDraft(
      d1,
      { versionsTable, collection: "pages" },
      { id: 7, publishedVersionId: 5 },
    );
    expect(draft).toEqual({ title: "newest pending", sections: [] });
  });

  it("never resumes a superseded draft — that would revert the page in edit mode", async () => {
    // Only draft 3 exists, and it's below the live pointer (5).
    const { d1 } = fakeD1(VERSIONS.filter((v) => v.id <= 5));
    expect(
      await resumeDraft(
        d1,
        { versionsTable, collection: "pages" },
        { id: 7, publishedVersionId: 5 },
      ),
    ).toBeNull();
  });

  it("agrees with latestPendingDraft, the rule applySaveDraft builds on", async () => {
    // The two must pick the same draft, or the editor sees one snapshot and
    // their next save layers onto another.
    for (const publishedVersionId of [null, 2, 5, 8, 9]) {
      const { d1 } = fakeD1(VERSIONS);
      const read = await resumeDraft(
        d1,
        { versionsTable, collection: "pages" },
        { id: 7, publishedVersionId },
      );
      const newestFirst = VERSIONS.filter((v) => v.parentId === 7)
        .sort((a, b) => b.id - a.id)
        .map((v) => ({ ...v }) as Record<string, unknown>);
      const rule = latestPendingDraft(newestFirst, publishedVersionId);
      expect(read).toEqual(rule?.versionData ?? null);
    }
  });

  it("with no live pointer, any draft counts as pending", async () => {
    const { d1, statements } = fakeD1(VERSIONS);
    const draft = await resumeDraft(
      d1,
      { versionsTable, collection: "pages" },
      { id: 7, publishedVersionId: null },
    );
    expect(draft).toMatchObject({ title: "newest pending" });
    // parentId, status, limit—no id floor.
    expect(statements[0]?.params).toEqual([7, "draft", 1]);
  });

  it("asks D1 for exactly one row, newest first", async () => {
    const { d1, statements } = fakeD1(VERSIONS);
    await resumeDraft(d1, { versionsTable, collection: "pages" }, { id: 7, publishedVersionId: 5 });
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toMatch(/order by "pages_versions"\."id" desc limit \?/i);
    expect(statements[0]?.params).toEqual([7, "draft", 5, 1]);
  });

  it("prefers the KV buffer, which is always ahead of D1, and skips the query", async () => {
    const { d1, statements } = fakeD1(VERSIONS);
    const kv = memoryKv();
    await writeDraftBuffer(kv, draftBufferKey("pages", 7), {
      data: { title: "typed a second ago" },
      updatedAt: 2,
      flushedAt: 1,
    });
    const draft = await resumeDraft(
      d1,
      { versionsTable, collection: "pages", bufferKv: kv },
      { id: 7, publishedVersionId: 5 },
    );
    expect(draft).toEqual({ title: "typed a second ago" });
    expect(statements).toHaveLength(0);
  });

  it("falls back to D1 when buffering is on but this page has no buffer", async () => {
    const { d1 } = fakeD1(VERSIONS);
    const kv = memoryKv();
    await writeDraftBuffer(kv, draftBufferKey("pages", 99), {
      data: { title: "a different page's buffer" },
      updatedAt: 1,
      flushedAt: 1,
    });
    const draft = await resumeDraft(
      d1,
      { versionsTable, collection: "pages", bufferKv: kv },
      { id: 7, publishedVersionId: 5 },
    );
    expect(draft).toMatchObject({ title: "newest pending" });
  });

  it("returns null for a page with no drafts at all", async () => {
    const { d1 } = fakeD1(VERSIONS);
    expect(
      await resumeDraft(
        d1,
        { versionsTable, collection: "pages" },
        { id: 1, publishedVersionId: null },
      ),
    ).toBeNull();
  });

  it("returns null rather than a non-object snapshot", async () => {
    const { d1 } = fakeD1([{ id: 1, parentId: 7, status: "draft", versionData: ["not", "a doc"] }]);
    expect(
      await resumeDraft(
        d1,
        { versionsTable, collection: "pages" },
        { id: 7, publishedVersionId: null },
      ),
    ).toBeNull();
  });
});
