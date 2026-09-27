// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Query-string normalization shared by the edge cache key and the canonical
// URL: keep the parameters a predicate accepts and sort them, so two URLs that
// differ only in parameter order or dropped parameters normalize the same.

/** `url` with only the query parameters `keep` accepts, sorted by name. */
export function filterQuery(url: URL, keep: (name: string) => boolean): URL {
  const out = new URL(url);
  if (!out.search) return out;
  const kept = [...out.searchParams.entries()]
    .filter(([name]) => keep(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  out.search = "";
  for (const [name, value] of kept) out.searchParams.append(name, value);
  return out;
}
