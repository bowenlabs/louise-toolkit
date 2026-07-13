// Slice a named region out of raw source imported with Vite's `?raw`, so the code
// panes on /examples/* cite real files and can never drift from what ships. A
// region is delimited by `#region NAME` … `#endregion` in any comment syntax
// (`// #region`, `{/* #region */}`, `<!-- #region -->`), so the same helper works
// for .ts and .astro. If the marker is missing, the whole trimmed file is returned.

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Strip the shared leading indentation off a block so a nested region reads flush.
function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((l) => l.trim() !== "")
    .map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min));
}

export function extractRegion(src: string, name: string): string {
  const startRe = new RegExp(`#region\\s+${escapeRe(name)}\\b`);
  const lines = src.split("\n");
  const from = lines.findIndex((l) => startRe.test(l));
  if (from === -1) return src.trim();
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((l) => /#endregion\b/.test(l));
  const body = to === -1 ? rest : rest.slice(0, to);
  return dedent(body).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
