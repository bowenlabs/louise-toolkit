// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The site-health detail panel (#106 Phase 2) — the drill-in behind the Home
// dashboard's Health card. It reads the full persisted HealthSummary (with the
// broken-link details the card's count doesn't carry) from /api/louise/health,
// lists what's wrong in plain language, and sends the owner to the surface that
// fixes each class of issue (Media for alt text, Pages for SEO). It's a hidden
// framework panel: reachable from the card's action, not a top-strip button.

import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
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

export function HealthPanel(props: { navigate: DashboardApi["open"]; endpoint?: string }) {
  const query = useQuery(() => ({
    queryKey: louiseQueryKeys.health,
    queryFn: () =>
      apiGet<{ summary: HealthSummary | null }>(props.endpoint ?? "/api/louise/health").then(
        (d) => d.summary,
      ),
  }));
  const summary = () => query.data ?? null;

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

              {/* Broken links — the one issue class with actionable detail here. */}
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

              {/* Alt / SEO — counts + a jump to the surface that fixes them. */}
              <HealthFixRow
                title="Image descriptions"
                count={s().missingAlt}
                unit="image"
                verb="missing a description"
                action="Fix in Media"
                onFix={() => props.navigate({ panel: "media" })}
              />
              <HealthFixRow
                title="Search engine info"
                count={s().seoGaps}
                unit="page"
                verb="missing SEO title or description"
                action="Fix in Pages"
                onFix={() => props.navigate({ panel: "pages" })}
              />
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}

/** One "N things need X → go fix them" row, hidden when the count is zero. */
function HealthFixRow(props: {
  title: string;
  count: number;
  unit: string;
  verb: string;
  action: string;
  onFix: () => void;
}) {
  const plural = () => (props.count === 1 ? props.unit : `${props.unit}s`);
  return (
    <section class="louise-settings-group">
      <h3 class="louise-settings-title">{props.title}</h3>
      <Show
        when={props.count > 0}
        fallback={
          <p class="louise-muted">
            <Icon name="check" /> All good.
          </p>
        }
      >
        <div class="louise-list-item">
          <div class="louise-item-main">
            <div class="louise-item-sub">
              {props.count} {plural()} {props.verb}.
            </div>
          </div>
          <button class="louise-btn" type="button" onClick={props.onFix}>
            {props.action}
          </button>
        </div>
      </Show>
    </section>
  );
}
