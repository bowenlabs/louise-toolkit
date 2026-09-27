// A site fact is a parameter, never a constant (CLAUDE.md § Site facts are
// parameters). This is the check behind that rule, for the three kinds of fact
// that leak in as a string literal: a currency, a locale, and a time zone.
//
// A hard-coded `"usd"` charges a site that sells in another currency the wrong
// amount rather than failing; a hard-coded `"en-US"` or `"America/Chicago"`
// shows an owner a date in someone else's format or clock. Whether a literal is
// a harmless provider default or a site fact used to be left to review. Now
// each one that stays is written down once, below, with its reason.
//
// Scans string literals in `packages/louise/src`, with comments stripped, for:
//
//   - an ISO 4217 currency code, either case, from the list in CURRENCIES
//   - a BCP 47 locale with a region: `en-US`, `fr-CA`
//   - an IANA time zone: `Area/Location`, for the areas in ZONE_AREAS
//
// A literal that's fine goes in ALLOWED, keyed by file and literal, with the
// reason: a provider default the caller can override, a formatter that only
// parses numbers out of `Intl` and never reaches a reader, and so on. Prefer a
// parameter to an entry.
//
//   node scripts/ci/checks/site-fact-literals.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** Currency codes that a sample, a default, or a fixture reaches for. */
const CURRENCIES = new Set([
  "usd",
  "eur",
  "gbp",
  "cad",
  "aud",
  "nzd",
  "jpy",
  "chf",
  "cny",
  "hkd",
  "sgd",
  "sek",
  "nok",
  "dkk",
  "mxn",
  "brl",
  "inr",
  "krw",
  "zar",
  "pln",
  "czk",
  "ils",
]);
const ZONE_AREAS = [
  "Africa",
  "America",
  "Antarctica",
  "Asia",
  "Atlantic",
  "Australia",
  "Europe",
  "Indian",
  "Pacific",
  "Etc",
];
const LOCALE = /^[a-z]{2,3}-[A-Z]{2}$/;
const ZONE = new RegExp(`^(?:${ZONE_AREAS.join("|")})/[A-Za-z_]+(?:/[A-Za-z_]+)?$`);

/** `file → literal → reason` for each literal that stays. */
const SQUARE_WRITE =
  "a fallback for a price the caller didn't give a currency; the input takes one";
const SQUARE_READ = "tags a Square response that left its currency out; Square names it";
const ALLOWED = {
  "packages/louise/src/core/commerce/stripe.ts": {
    usd: "overridable default: every Stripe helper takes `currency`, and all sites sell in USD today",
  },
  "packages/louise/src/core/commerce/square/catalog.ts": { USD: SQUARE_READ },
  "packages/louise/src/core/commerce/square/catalog-details.ts": { USD: SQUARE_WRITE },
  "packages/louise/src/core/commerce/square/invoices.ts": { USD: SQUARE_WRITE },
  "packages/louise/src/core/commerce/square/labor.ts": {
    USD: `${SQUARE_READ}, and ${SQUARE_WRITE}`,
  },
  "packages/louise/src/core/commerce/square/locations.ts": { USD: SQUARE_READ },
  "packages/louise/src/core/commerce/square/wire.ts": {
    USD: `${SQUARE_READ}, and ${SQUARE_WRITE}`,
  },
  "packages/louise/src/core/commerce/fourthwall-platform.ts": {
    USD: "tags Fourthwall money that left its currency out; Fourthwall names it",
  },
  "packages/louise/src/core/dates/index.ts": {
    "en-CA": "parse-only: `isoDateIn` reads YYYY-MM-DD parts out of Intl; never shown",
    "en-US": "overridable `formatDate` default, and parse-only in `offsetAt`",
  },
};

function kind(literal) {
  if (CURRENCIES.has(literal.toLowerCase()) && /^(?:[a-z]{3}|[A-Z]{3})$/.test(literal)) {
    return "currency";
  }
  if (LOCALE.test(literal)) return "locale";
  if (ZONE.test(literal)) return "time zone";
  return null;
}

/** Blank out comments, keeping line breaks, so a JSDoc example isn't a hit. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const files = execFileSync("git", ["ls-files", "packages/louise/src"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(?:ts|tsx|mjs|js)$/.test(file) && fs.existsSync(file));

const hits = [];
const used = new Set();
for (const file of files) {
  const lines = stripComments(fs.readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    for (const match of line.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      const literal = match[2];
      const what = kind(literal);
      if (!what) continue;
      if (ALLOWED[file]?.[literal]) {
        used.add(`${file}\0${literal}`);
        continue;
      }
      hits.push({ file, line: i + 1, literal, what });
    }
  });
}

const stale = Object.entries(ALLOWED).flatMap(([file, literals]) =>
  Object.keys(literals)
    .filter((literal) => !used.has(`${file}\0${literal}`))
    .map((literal) => `${file}: "${literal}"`),
);

if (hits.length === 0 && stale.length === 0) {
  console.log(`No unrecorded currency, locale, or time zone literals in ${files.length} files.`);
  process.exit(0);
}
for (const { file, line, literal, what } of hits) {
  console.error(`  ${file}:${line}  ${what} "${literal}"`);
}
for (const entry of stale) console.error(`  stale allowlist entry, no longer found: ${entry}`);
console.error(
  [
    "",
    "A currency, locale, or time zone is a fact about a site, so it's a parameter.",
    "Take it from the caller. If the literal is a provider default the caller can",
    "override, or never reaches a reader, add it to ALLOWED in",
    "scripts/ci/checks/site-fact-literals.mjs with its reason. Remove an entry",
    "whose literal is gone.",
  ].join("\n"),
);
process.exit(1);
