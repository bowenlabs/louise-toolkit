// Prove the changesets stack still LOADS. Nothing else in the suite touches it.
//
// Why this exists: the CVE override for js-yaml landed without an `@4` selector,
// so it applied to every dependent — including `read-yaml-file@1.1.0`, which asks
// for `^3.6.1` and calls `yaml.safeLoad`, removed in 4.x. changesets reads
// `pnpm-workspace.yaml` through that package, so from #414 onward every
// `changeset` command died on contact. Eighteen check legs stayed green the whole
// time, because not one of them loaded changesets. The release was broken and the
// only thing that would ever have said so was a release.
//
// Deliberately NOT a "every change needs a changeset" policy gate. `changeset
// status` conflates the two, and that policy is legitimately violated by the
// release PR itself, where `changeset version` has just consumed every changeset.
// Failing that PR would train people to bypass the check — so the one non-zero
// exit tolerated here is exactly that message, and nothing else.
//
//   node scripts/ci/checks/release-tooling.mjs

import { spawnSync } from "node:child_process";

// `--since=HEAD` is load-bearing, and its absence failed this check the first
// time it ran in CI. Bare `changeset status` diffs against the configured base
// branch, so it needs `main` to exist locally — which it does not in Actions'
// shallow checkout, giving `Failed to find where HEAD diverged from "main"`.
// That has nothing to do with the health of the stack. `merge-base HEAD HEAD`
// is satisfiable in any checkout, depth-1 included, while still loading the
// config, resolving the workspace through `pnpm-workspace.yaml`, and reading
// `.changeset/` — which is the whole code path under test.
const r = spawnSync("corepack", ["pnpm", "exec", "changeset", "status", "--since=HEAD"], {
  encoding: "utf8",
  shell: false,
});

const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;

if (r.error) {
  console.error(`✗ could not run changesets: ${r.error.message}`);
  process.exit(1);
}
if (r.status === 0) {
  console.log("Release tooling OK: the changesets stack loads and read the workspace.");
  process.exit(0);
}

// The pending-changeset policy, not a broken stack. Reaching this message means
// changesets started, parsed its config and diffed the workspace — which is the
// whole thing under test.
if (/no changesets were found/i.test(output)) {
  console.log("Release tooling OK: stack loads (no pending changesets, which is fine here).");
  process.exit(0);
}

console.error("✗ the changesets stack failed to run. A release would fail with this:\n");
console.error(output.trim());
process.exit(1);
