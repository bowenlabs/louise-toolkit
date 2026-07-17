// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The site-health detail panel (#106 Phase 2) — the drill-in behind the Home
// dashboard's Health card. It reads the full persisted HealthSummary (with the
// broken-link details the card's count doesn't carry) from /api/louise/health
// and lists what's wrong in plain language. Two issue classes offer a one-click
// AI fix (Phase 2b/2c): image descriptions (alt text) and SEO title/description —
// each with a manual "Review in …" fallback. It's a hidden framework panel:
// reachable from the card's action, not a top-strip button.

import { type QueryClient, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import type { CwvSummary } from "../../../core/analytics/index.js";
import type { HealthSummary } from "../../../core/health/index.js";
import { Icon } from "../../icons.jsx";
import { apiGet, louiseQueryKeys } from "../query.js";
import type { DashboardApi } from "./types.js";

/** Compact relative-time ("2h ago"); falls back to the date for older scans. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

interface Fixer {
  fixing: () => boolean;
  unavailable: () => boolean;
  error: () => string | null;
  run: () => Promise<void>;
}

/** A one-click AI fix: POST the backfill endpoint, then refresh the counts it
 *  changed (always health + the dashboard overview, plus the fixed collection).
 *  A 503 means the site has no AI binding wired, so the assist hides itself. */
function createFixer(qc: QueryClient, endpoint: string, extraKeys: readonly unknown[][]): Fixer {
  const [fixing, setFixing] = createSignal(false);
  const [unavailable, setUnavailable] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const run = async () => {
    setFixing(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.status === 503) {
        setUnavailable(true);
        return;
      }
      if (!res.ok) {
        setError(`Couldn’t apply the fix (${res.status}).`);
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: louiseQueryKeys.health }),
        qc.invalidateQueries({ queryKey: louiseQueryKeys.overview }),
        ...extraKeys.map((key) => qc.invalidateQueries({ queryKey: key })),
      ]);
    } catch {
      setError("Couldn’t reach the server.");
    } finally {
      setFixing(false);
    }
  };
  return { fixing, unavailable, error, run };
}

export function HealthPanel(props: {
  navigate: DashboardApi["open"];
  endpoint?: string;
  /** Endpoint for the one-click alt backfill. Default `/api/louise/media/generate-alt`. */
  fixAltEndpoint?: string;
  /** Endpoint for the one-click SEO backfill. Default `/api/louise/pages/generate-seo`. */
  fixSeoEndpoint?: string;
}) {
  const qc = useQueryClient();
  const query = useQuery(() => ({
    queryKey: louiseQueryKeys.health,
    queryFn: () =>
      apiGet<{ summary: HealthSummary | null }>(props.endpoint ?? "/api/louise/health").then(
        (d) => d.summary,
      ),
  }));
  const summary = () => query.data ?? null;

  const altFix = createFixer(qc, props.fixAltEndpoint ?? "/api/louise/media/generate-alt", [
    louiseQueryKeys.media,
  ]);
  const seoFix = createFixer(qc, props.fixSeoEndpoint ?? "/api/louise/pages/generate-seo", [
    louiseQueryKeys.pages,
  ]);
  const count = (n: number, unit: string) => `${n} ${n === 1 ? `${unit} is` : `${unit}s are`}`;

  return (
    <div>
      <button class="louise-btn" type="button" onClick={() => props.navigate({ panel: "home" })}>
        ← Home
      </button>
      <div style={{ height: "14px" }} />

      <Show when={!query.isLoading} fallback={<p class="louise-muted">Loading…</p>}>
        <Show
          when={summary()}
          fallback={
            <p class="louise-muted">
              No health check yet — the daily scan will populate this shortly.
            </p>
          }
        >
          {(s) => (
            <>
              <p class="louise-muted louise-settings-hint">
                Last checked {timeAgo(s().checkedAt) || "recently"}.
              </p>

              {/* Broken links — listed for review; nothing to auto-fix here. */}
              <section class="louise-settings-group">
                <h3 class="louise-settings-title">Broken links</h3>
                <Show
                  when={(s().brokenLinkDetails ?? []).length > 0}
                  fallback={<p class="louise-muted">No broken links found.</p>}
                >
                  <div class="louise-list">
                    <For each={s().brokenLinkDetails}>
                      {(b) => (
                        <div class="louise-list-item">
                          <div class="louise-item-main">
                            <div class="louise-item-title">{b.url}</div>
                            <div class="louise-item-sub">
                              {b.status === "error" ? "Didn’t respond" : `Returned ${b.status}`} ·
                              on {b.from}
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                  <Show when={s().brokenLinks > (s().brokenLinkDetails ?? []).length}>
                    <p class="louise-muted louise-settings-hint">
                      …and {s().brokenLinks - (s().brokenLinkDetails ?? []).length} more.
                    </p>
                  </Show>
                </Show>
              </section>

              <AiFixSection
                heading="Image descriptions"
                count={s().missingAlt}
                message={`${count(s().missingAlt, "image")} missing a description.`}
                allClear="Every image has a description."
                fixer={altFix}
                reviewLabel="Review in Media"
                onReview={() => props.navigate({ panel: "media" })}
                unavailableNote="AI descriptions aren’t set up for this site — add them by hand in Media."
              />

              <AiFixSection
                heading="Search engine info"
                count={s().seoGaps}
                message={`${count(s().seoGaps, "page")} missing an SEO title or description.`}
                allClear="Every page has search info."
                fixer={seoFix}
                reviewLabel="Review in Pages"
                onReview={() => props.navigate({ panel: "pages" })}
                unavailableNote="AI SEO isn’t set up for this site — add titles/descriptions by hand in Pages."
              />

              <PerformanceSection cwv={s().cwv} />
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}

const fmtTime = (v?: number) =>
  v == null ? "—" : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`;
const RATING_LABEL: Record<CwvSummary["rating"], string> = {
  good: "Fast",
  "needs-improvement": "Could be faster",
  poor: "Slow",
  none: "",
};

/** Real-visitor Core Web Vitals as a plain-language badge (#106 CWV). Owner
 *  wording, not jargon; "not measured yet" until field data arrives. */
function PerformanceSection(props: { cwv?: CwvSummary }) {
  return (
    <section class="louise-settings-group">
      <h3 class="louise-settings-title">Performance</h3>
      <Show
        when={props.cwv && props.cwv.rating !== "none" ? props.cwv : undefined}
        fallback={
          <p class="louise-muted">
            Not measured yet — real-visitor speed appears here once traffic comes in.
          </p>
        }
      >
        {(cwv) => (
          <>
            <span class="louise-cwv-badge" data-rating={cwv().rating}>
              {RATING_LABEL[cwv().rating]}
            </span>
            <div class="louise-cwv-metrics louise-muted">
              <span>Loading: {fmtTime(cwv().lcp)}</span>
              <span>Responsiveness: {fmtTime(cwv().inp)}</span>
              <span>Visual stability: {cwv().cls == null ? "—" : cwv().cls!.toFixed(2)}</span>
            </div>
          </>
        )}
      </Show>
    </section>
  );
}

/** An issue class Louise can fix automatically: the plain-language count, a
 *  one-click "Fix with AI", and a manual "Review in …" fallback. Hidden verb when
 *  the count is zero (all-clear), and the AI button when no runner is wired. */
function AiFixSection(props: {
  heading: string;
  count: number;
  message: string;
  allClear: string;
  fixer: Fixer;
  reviewLabel: string;
  onReview: () => void;
  unavailableNote: string;
}) {
  return (
    <section class="louise-settings-group">
      <h3 class="louise-settings-title">{props.heading}</h3>
      <Show
        when={props.count > 0}
        fallback={
          <p class="louise-muted">
            <Icon name="check" /> {props.allClear}
          </p>
        }
      >
        <div class="louise-list-item">
          <div class="louise-item-main">
            <div class="louise-item-sub">{props.message}</div>
          </div>
          <Show when={!props.fixer.unavailable()}>
            <button
              class="louise-btn louise-btn-primary"
              type="button"
              disabled={props.fixer.fixing()}
              onClick={() => void props.fixer.run()}
            >
              {props.fixer.fixing() ? "Fixing…" : "Fix with AI"}
            </button>
          </Show>
          <button class="louise-btn" type="button" onClick={props.onReview}>
            {props.reviewLabel}
          </button>
        </div>
        <Show when={props.fixer.unavailable()}>
          <p class="louise-muted louise-settings-hint">{props.unavailableNote}</p>
        </Show>
        <Show when={props.fixer.error()}>
          <div class="louise-alert" role="alert">
            {props.fixer.error()}
          </div>
        </Show>
      </Show>
    </section>
  );
}
