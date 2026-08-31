// Build-time read of PUBLISHED pages from D1 via the Cloudflare D1 REST API, for
// the `louiseLoader` example (src/content.config.ts). A Content Layer loader runs
// during `astro build` in Node — off any Worker binding — so it reaches D1 over
// REST instead of the `env.DB` binding the SSR pages use. Gated on three server
// env vars (astro.config.mjs `env.schema`); when any is unset (a plain local
// build / CI without secrets) it returns [] so the build still succeeds with an
// empty collection.
import { CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID } from "astro:env/server";
import type { LouiseRow } from "@louise-toolkit/astro";

// Published-page columns, aliased to the `pagesCollection` field keys: the D1
// columns are snake_case, but the collection — and so the loader's schema — is
// camelCase, so alias here rather than remapping every row.
const SQL = `
  SELECT slug, title, body,
         seo_title AS seoTitle, seo_description AS seoDescription, og_image AS ogImage,
         noindex, sort_order AS sortOrder, sections
  FROM pages
  WHERE status = 'published'
  ORDER BY sort_order
`;

interface D1QueryResponse {
  success: boolean;
  errors?: { message: string }[];
  result?: { results?: Record<string, unknown>[] }[];
}

export async function readPublishedPages(): Promise<LouiseRow[]> {
  if (!CF_ACCOUNT_ID || !CF_D1_DATABASE_ID || !CF_API_TOKEN) {
    console.warn(
      "[louiseLoader] D1 REST env vars unset — `publishedPages` will build empty. " +
        "Set CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN to populate it.",
    );
    return [];
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({ sql: SQL }),
    },
  );
  if (!res.ok) throw new Error(`D1 REST query failed: ${res.status} ${res.statusText}`);

  const payload = (await res.json()) as D1QueryResponse;
  if (!payload.success) {
    const detail = payload.errors?.map((e) => e.message).join("; ") ?? "unknown error";
    throw new Error(`D1 REST query returned an error: ${detail}`);
  }

  const rows = payload.result?.[0]?.results ?? [];
  // `sections` is a text(json) column — the REST API returns it as the raw
  // stored JSON string, so parse it back into the array the schema expects.
  return rows.map((row) => ({
    ...row,
    sections: typeof row.sections === "string" ? safeJsonParse(row.sections) : row.sections,
  }));
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
