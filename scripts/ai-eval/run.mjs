// Measure the AI helpers against real Workers AI before a default model or a
// prompt changes (#554).
//
// The unit tests stub the runner, so they prove the plumbing and nothing about
// the output. This runs fixed inputs (fixtures.mjs) through the BUILT helpers
// and applies code checks, no judge model: no preamble, lengths within caps,
// names, numbers, and URLs kept through a rewrite, `fix` changing few words, and
// SEO suggestions that fit without truncation. It prints a Markdown table to
// paste into the pull request, so a change's effect shows as numbers.
//
// It spends Workers AI budget (roughly 95 model calls a run), so it isn't part
// of CI. Run it by hand, before and after the change:
//
//   corepack pnpm -C packages/louise run build
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/ai-eval/run.mjs
//   node scripts/ai-eval/run.mjs --model @cf/meta/llama-3.1-8b-instruct-fast
//   node scripts/ai-eval/run.mjs --only seo
//
// The token needs Workers AI Read and Edit. `--model` overrides the text model
// for the text helpers, and `--vision-model` the alt-text model, which is how
// to compare a candidate with the default. `--only` is `rewrite`, `seo`, or
// `alt`. The alt-text images are flat drawings (png.mjs), so the checks can ask
// for their colors and shapes; they measure whether a model describes what's
// there, not how well it handles a photograph.

import { ALT_FIXTURES, FIX_FIXTURES, REWRITE_FIXTURES, SEO_FIXTURES } from "./fixtures.mjs";
import { drawPng } from "./png.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const ai = await import(
  new URL("../../packages/louise/dist/core/ai/index.js", import.meta.url).href
).catch(() => {
  console.error("ai-eval: build the library first: corepack pnpm -C packages/louise run build");
  process.exit(1);
});

/** A runner over the Workers AI REST API, shaped like the `env.AI` binding. */
export function restRunner(account, token, fetchImpl = fetch) {
  return {
    async run(model, inputs) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(inputs),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        const errors = body?.errors?.map((e) => e.message).join("; ") ?? res.statusText;
        throw new Error(`HTTP ${res.status}: ${errors}`);
      }
      return body.result;
    },
  };
}

// ── Checks ───────────────────────────────────────────────────────────────────

const PREAMBLE = /^(sure|certainly|of course|here(?:'s| is| are)|below is|rewritten)/i;
const words = (s) => s.toLowerCase().match(/[\p{L}\p{N}'’$%.-]+/gu) ?? [];

/** Word-level edit distance over the longer text's length: 0 is identical. */
function changeRatio(a, b) {
  const x = words(a);
  const y = words(b);
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[y.length] / Math.max(x.length, y.length, 1);
}

/** How much longer (or shorter) the rewrite may be than its input, per mode. */
const LENGTH_LIMITS = {
  tighten: [0.2, 1.0],
  rephrase: [0.5, 1.5],
  simplify: [0.4, 1.3],
  fix: [0.8, 1.2],
};

/** Each check returns `null` on a pass, or a short reason. */
function rewriteChecks(mode, input, output, keep) {
  if (output === null) return { returned: "null" };
  const ratio = output.length / input.length;
  const [min, max] = LENGTH_LIMITS[mode];
  const lost = keep.filter((k) => !output.includes(k));
  return {
    returned: null,
    "no preamble": PREAMBLE.test(output) || /^["'“]/.test(output) ? output.slice(0, 40) : null,
    length: ratio < min || ratio > max ? `${ratio.toFixed(2)}× input` : null,
    "keeps names, numbers, URLs": lost.length ? `lost ${lost.join(", ")}` : null,
  };
}

function fixChecks(input, output, fixture) {
  if (output === null) return { returned: "null" };
  const left = Object.keys(fixture.fixes).filter((m) => output.includes(m));
  const lost = fixture.keep.filter((k) => !output.includes(k));
  const change = changeRatio(input, output);
  return {
    returned: null,
    "no preamble": PREAMBLE.test(output) ? output.slice(0, 40) : null,
    "fixes the mistakes": left.length ? `left ${left.join(", ")}` : null,
    "changes few words": change > 0.25 ? `${Math.round(change * 100)}% of words changed` : null,
    "keeps names, numbers, URLs": lost.length ? `lost ${lost.join(", ")}` : null,
  };
}

function seoChecks(output, topic) {
  if (output === null) return { returned: "null" };
  const both = `${output.title ?? ""} ${output.description ?? ""}`.toLowerCase();
  return {
    returned: null,
    "has title and description": output.title && output.description ? null : "a field is missing",
    "fits without truncation":
      output.title?.endsWith("…") || output.description?.endsWith("…") ? "truncated to fit" : null,
    "title isn't the description": output.title === output.description ? "identical" : null,
    "mentions the topic": both.includes(topic.toLowerCase()) ? null : `no "${topic}"`,
  };
}

function altChecks(output, mentions) {
  if (output === null) return { returned: "null" };
  const text = output.toLowerCase();
  const missing = mentions.filter((alts) => !alts.split("|").some((w) => text.includes(w)));
  return {
    returned: null,
    "under the length cap": output.endsWith("…") ? "truncated to fit" : null,
    "no lead-in": /^(an?|the) (image|picture|photo)/i.test(output) ? output.slice(0, 40) : null,
    "names the colors and shapes": missing.length ? `no ${missing.join(", ")}` : null,
  };
}

// ── Running ──────────────────────────────────────────────────────────────────

/** Run every case, tallying passes per check. Sequential, to stay well under rate limits. */
export async function evaluate(runner, { model, visionModel, only } = {}) {
  const results = [];
  const record = (helper, label, checks) => results.push({ helper, label, checks });

  if (!only || only === "rewrite") {
    for (const mode of ["tighten", "rephrase", "simplify"]) {
      for (const [i, f] of REWRITE_FIXTURES.entries()) {
        const out = await ai.rewriteText(runner, f.text, { mode, model });
        record(`rewrite (${mode})`, `#${i + 1}`, rewriteChecks(mode, f.text, out, f.keep));
      }
    }
    for (const [i, f] of FIX_FIXTURES.entries()) {
      const out = await ai.rewriteText(runner, f.text, { mode: "fix", model });
      record("rewrite (fix)", `#${i + 1}`, fixChecks(f.text, out, f));
    }
  }
  if (!only || only === "seo") {
    for (const [i, f] of SEO_FIXTURES.entries()) {
      const out = await ai.suggestSeo(runner, f.content, { model });
      record("suggestSeo", `#${i + 1}`, seoChecks(out, f.topic));
    }
  }
  if (!only || only === "alt") {
    for (const [i, f] of ALT_FIXTURES.entries()) {
      const out = await ai.generateAltText(runner, drawPng(f), { model: visionModel });
      record("generateAltText", `#${i + 1}`, altChecks(out, f.mentions));
    }
  }
  return results;
}

/** The Markdown report: pass counts per helper and check, then each failure. */
export function report(results, model, visionModel) {
  const lines = [
    `**AI helper eval** · text \`${model}\` · vision \`${visionModel}\` · ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];
  lines.push("| Helper | Check | Passed |", "| --- | --- | ---: |");
  const failures = [];
  const helpers = [...new Set(results.map((r) => r.helper))];
  for (const helper of helpers) {
    const rows = results.filter((r) => r.helper === helper);
    const checks = [...new Set(rows.flatMap((r) => Object.keys(r.checks)))];
    for (const check of checks) {
      // A case that returned nothing fails every check it couldn't run.
      const passed = rows.filter(
        (r) => r.checks.returned === null && r.checks[check] === null,
      ).length;
      lines.push(`| ${helper} | ${check} | ${passed}/${rows.length} |`);
    }
    for (const r of rows) {
      for (const [check, why] of Object.entries(r.checks)) {
        if (why !== null) failures.push(`- ${helper} ${r.label}, ${check}: ${why}`);
      }
    }
  }
  if (failures.length)
    lines.push("", "<details><summary>Failures</summary>", "", ...failures, "", "</details>");
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) {
    console.error(
      "ai-eval: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI Read and Edit).",
    );
    process.exit(1);
  }
  const model = flag("model") ?? ai.DEFAULT_TEXT_MODEL;
  const visionModel = flag("vision-model") ?? ai.DEFAULT_ALT_TEXT_MODEL;
  const only = flag("only");
  const runner = restRunner(account, token);
  // The helpers swallow errors by design, so a bad token or a retired model
  // would read as every case returning nothing. One direct call fails fast.
  try {
    await runner.run(model, {
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 4,
    });
  } catch (err) {
    console.error(`ai-eval: ${model} didn't answer: ${err.message}`);
    process.exit(1);
  }
  const results = await evaluate(runner, { model, visionModel, only });
  console.log(report(results, model, visionModel));
}
