// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Wildcard host dispatch: the parts that are the same for every site, and
// nothing that decides anything.
//
// Astroid owns two things a site cannot own on its own — the wildcard Worker
// route (`hosts` can only express custom domains) and the single middleware file
// Astro permits. What a subdomain MEANS, whether the lookup is cached, and what
// an unknown host should do are all site policy, and live in the scaffolded
// `src/tenancy.ts`.

import type { AstroidConfig, TenancyConfig } from "../config.js";

/** Default internal prefix a tenant request is rewritten to. */
export const ASTROID_TENANT_PREFIX = "/t";

/**
 * The Cloudflare zone a wildcard pattern belongs to.
 *
 * Defaults to the pattern minus its leading `*.`, which is right whenever the
 * wildcard sits directly under the apex. A deeper pattern needs `zone` set
 * explicitly: `*.shop.example.com` is served by the `example.com` zone, and
 * guessing `shop.example.com` there produces a deploy error naming a zone that
 * does not exist.
 */
export function tenancyZone(tenancy: TenancyConfig): string {
  return tenancy.zone ?? tenancy.hostPattern.replace(/^\*\./, "");
}

/**
 * The subdomain label for a host under the wildcard, or `null` when the host is
 * not a tenant candidate at all.
 *
 * `null` covers three distinct cases that all mean "render the ordinary site":
 * the apex itself (a wildcard does not match its own apex), a host outside the
 * pattern (a preview domain, `localhost`), and a reserved label.
 *
 * Exported and pure so a site can unit-test its own reserved list without
 * standing up a request.
 */
export function tenantLabel(host: string, tenancy: TenancyConfig): string | null {
  const suffix = tenancy.hostPattern.replace(/^\*\./, "");
  // Strip a port: `acme.example.com:8788` under `wrangler dev`.
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (!hostname.endsWith(`.${suffix}`)) return null;

  const label = hostname.slice(0, -(suffix.length + 1));
  // Only a single label is a tenant. `a.b.example.com` under `*.example.com` is
  // not `a.b` — Cloudflare's wildcard matches one level, and treating a dotted
  // string as a slug would put a `/` in a rewrite path.
  if (!label || label.includes(".")) return null;

  const reserved = tenancy.reserved ?? [];
  return reserved.includes(label) ? null : label;
}

/**
 * The scaffold-once `src/tenancy.ts` — the seam holding every decision Astroid
 * refuses to make for a site.
 *
 * Written once and then yours: what a label resolves to, whether the lookup is
 * cached, and what an unknown label means are all questions with site-specific
 * answers, and a framework that guessed them would be wrong in a different way
 * for each project.
 */
export function generateAstroidTenancy(config: AstroidConfig): string | null {
  const tenancy = config.tenancy;
  if (!tenancy) return null;
  const prefix = tenancy.rewritePrefix ?? ASTROID_TENANT_PREFIX;
  const example = (tenancy.hostPattern ?? "*.example.com").replace(/^\*\./, "");

  return [
    "// Scaffolded once by astroidjs — yours to edit.",
    "//",
    "// What a subdomain MEANS. The generated middleware has already decided this",
    "// host is a tenant candidate (it matches your wildcard and is not reserved);",
    "// everything after that is your call.",
    "//",
    `// A match rewrites internally to \`${prefix}/<slug>/…\`, so put the pages under`,
    `// \`src/pages${prefix}/[tenant]/\`. The visitor's URL never changes.`,
    "",
    "/** What your pages read off `Astro.locals.tenant`. Widen it freely. */",
    "export interface Tenant {",
    "  /** Used to build the internal path, so keep it URL-safe. */",
    "  slug: string;",
    "}",
    "",
    "/**",
    " * Resolve a subdomain label to a tenant, or `null` if there isn't one.",
    " *",
    " * `null` falls through to the ordinary site — which is a real choice, not a",
    " * default: a stranger's subdomain then renders your homepage. If that is wrong",
    " * for this project, return null here and refuse it in the middleware's `guard`",
    " * with a 404, so an unknown host is unambiguously not a page.",
    " *",
    " * This runs on EVERY request to a tenant host, so a database lookup here is a",
    " * query per request. Cache it — a module-scope Map is enough within an isolate,",
    " * KV if the tenant set is large or changes without a deploy.",
    " */",
    "export async function resolveTenant(label: string): Promise<Tenant | null> {",
    `  // TODO(astroid): look \`label\` up — a D1 table, a KV entry, or a literal map`,
    `  // while the set is small. Example: acme.${example} → { slug: "acme" }.`,
    "  return { slug: label };",
    "}",
    "",
  ].join("\n");
}
