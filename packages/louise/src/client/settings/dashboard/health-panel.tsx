// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The site-health detail panel (#106 Phase 2)—the drill-in behind the Home
// dashboard's Health card. It reads the full persisted HealthSummary (with the
// broken-link details the card's count doesn't carry) from /api/louise/health
// and lists what's wrong in plain language. Two issue classes offer a one-click
// AI fix (Phase 2b/2c): image descriptions (alt text) and SEO title/description—each
// with a manual "Review in …" fallback. It's a hidden framework panel:
// reachable from the card's action, not a top-strip button.

import { type QueryClient, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import type { CwvSummary } from "../../../core/analytics/index.js";
import { HEALTH_STALE_AFTER_MS, type HealthSummary, isStale } from "../../../core/health/index.js";
import { Icon } from "../../icons.jsx";
import { EmptyState, ErrorState, Skeleton } from "../../states.jsx";
import { apiErrorMessage, apiGet, louiseQueryKeys } from "../query.js";
import type { DashboardApi } from "./types.js";

/** Compact relative time ("just now", minutes or hours ago); falls back to the date for older scans. */
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

/** One AI suggestion under review: what it's for, and its editable fields. */
interface Suggestion {
  id: string;
  /** What it's for, such as a file name or a page title. */
  label: string;
  fields: Array<{ name: string; label: string; value: string }>;
}

/** An AI backfill the owner reviews before anything is saved (#549). */
interface Reviewer {
  suggesting: () => boolean;
  unavailable: () => boolean;
  error: () => string | null;
  /** What was saved, such as "Saved 3 descriptions." */
  notice: () => string | null;
  items: () => Suggestion[];
  suggest: () => Promise<void>;
  setValue: (id: string, field: string, value: string) => void;
  accept: (id: string) => Promise<void>;
  skip: (id: string) => void;
  acceptAll: () => Promise<void>;
}

/**
 * Ask the backfill endpoint for suggestions, then save only what the owner
 * accepts, through `save`. Nothing is written by asking. A 503 means the site
 * has no AI binding, so the assist hides itself. After a save, the counts it
 * changed are refreshed.
 */
function createReviewer(
  qc: QueryClient,
  opts: {
    endpoint: string;
    // `readonly` inner arrays so the `as const` query-key tuples fit.
    extraKeys: readonly (readonly unknown[])[];
    toItems: (body: unknown) => Suggestion[];
    /** Save an accepted suggestion. Resolves with a note for the owner, if any. */
    save: (item: Suggestion) => Promise<string | void>;
    savedNote: (n: number) => string;
  },
): Reviewer {
  const [suggesting, setSuggesting] = createSignal(false);
  const [unavailable, setUnavailable] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [items, setItems] = createSignal<Suggestion[]>([]);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: louiseQueryKeys.health }),
      qc.invalidateQueries({ queryKey: louiseQueryKeys.overview }),
      ...opts.extraKeys.map((key) => qc.invalidateQueries({ queryKey: key })),
    ]);

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(opts.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.status === 503) {
        setUnavailable(true);
        return;
      }
      if (!res.ok) {
        setError("Couldn’t get suggestions right now. Nothing has changed.");
        return;
      }
      const found = opts.toItems(await res.json().catch(() => null));
      setItems(found);
      if (found.length === 0)
        setNotice("No suggestions this time. Try again, or fill these in by hand.");
    } catch {
      setError("Couldn’t reach the server. Nothing has changed.");
    } finally {
      setSuggesting(false);
    }
  };

  const setValue = (id: string, field: string, value: string) =>
    setItems((list) =>
      list.map((item) =>
        item.id === id
          ? { ...item, fields: item.fields.map((f) => (f.name === field ? { ...f, value } : f)) }
          : item,
      ),
    );
  const remove = (id: string) => setItems((list) => list.filter((item) => item.id !== id));

  /** Save the accepted items one at a time; stop at the first failure. */
  const saveEach = async (ids: string[]) => {
    setError(null);
    let saved = 0;
    let note: string | undefined;
    for (const id of ids) {
      const item = items().find((i) => i.id === id);
      if (!item) continue;
      try {
        note = (await opts.save(item)) || note;
        remove(id);
        saved++;
      } catch {
        setError(`Couldn’t save the suggestion for ${item.label}. The others are still here.`);
        break;
      }
    }
    if (saved > 0) {
      setNotice(note ? `${opts.savedNote(saved)} ${note}` : opts.savedNote(saved));
      await refresh();
    }
  };

  return {
    suggesting,
    unavailable,
    error,
    notice,
    items,
    suggest,
    setValue,
    accept: (id) => saveEach([id]),
    skip: remove,
    acceptAll: () => saveEach(items().map((i) => i.id)),
  };
}

export function HealthPanel(props: {
  navigate: DashboardApi["open"];
  endpoint?: string;
  /** Endpoint for the one-click alt backfill. Default `/api/louise/media/generate-alt`. */
  fixAltEndpoint?: string;
  /** Endpoint for the one-click SEO backfill. Default `/api/louise/pages/generate-seo`. */
  fixSeoEndpoint?: string;
  /** The media route, where an accepted description is saved. Default `/api/louise/media`. */
  mediaEndpoint?: string;
  /** How old the last check can get, in milliseconds, before the panel marks it
   *  out of date. Default {@link HEALTH_STALE_AFTER_MS} (36 hours), which suits a
   *  daily scan; raise it for a scan that runs less often. */
  staleAfterMs?: number;
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

  const altFix = createReviewer(qc, {
    endpoint: props.fixAltEndpoint ?? "/api/louise/media/generate-alt",
    extraKeys: [louiseQueryKeys.media],
    toItems: (body) =>
      ((body as { suggestions?: { key: string; alt: string }[] } | null)?.suggestions ?? []).map(
        (s) => ({
          id: s.key,
          label: s.key.split("/").pop() ?? s.key,
          fields: [{ name: "alt", label: "Description", value: s.alt }],
        }),
      ),
    save: async (item) => {
      const res = await fetch(props.mediaEndpoint ?? "/api/louise/media", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: item.id, alt: item.fields[0]!.value.trim() || null }),
      });
      if (!res.ok) throw new Error(`alt save failed: ${res.status}`);
    },
    savedNote: (n) => `Saved ${n} ${n === 1 ? "description" : "descriptions"}.`,
  });
  const seoEndpoint = props.fixSeoEndpoint ?? "/api/louise/pages/generate-seo";
  const seoFix = createReviewer(qc, {
    endpoint: seoEndpoint,
    extraKeys: [louiseQueryKeys.pages],
    toItems: (body) =>
      (
        (
          body as {
            suggestions?: {
              id: number;
              title: string;
              slug: string;
              seoTitle: string | null;
              seoDescription: string | null;
            }[];
          } | null
        )?.suggestions ?? []
      ).map((s) => ({
        id: String(s.id),
        label: s.title || `/${s.slug}`,
        fields: [
          ...(s.seoTitle ? [{ name: "seoTitle", label: "SEO title", value: s.seoTitle }] : []),
          ...(s.seoDescription
            ? [{ name: "seoDescription", label: "SEO description", value: s.seoDescription }]
            : []),
        ],
      })),
    save: async (item) => {
      const body: Record<string, unknown> = { id: Number(item.id) };
      for (const f of item.fields) if (f.value.trim()) body[f.name] = f.value.trim();
      const res = await fetch(`${seoEndpoint}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`SEO save failed: ${res.status}`);
      const data = (await res.json().catch(() => null)) as { draft?: boolean } | null;
      if (data?.draft) return "They’re saved as drafts; publish those pages to make them live.";
    },
    savedNote: (n) => `Saved search info for ${n} ${n === 1 ? "page" : "pages"}.`,
  });
  const count = (n: number, unit: string) => `${n} ${n === 1 ? `${unit} is` : `${unit}s are`}`;

  return (
    <div>
      <button class="louise-btn" type="button" onClick={() => props.navigate({ panel: "home" })}>
        ← Home
      </button>
      <div style={{ height: "14px" }} />

      <Show
        when={!query.isLoading}
        fallback={<Skeleton label="Loading your site’s health" shape="panel" count={4} />}
      >
        <Show
          when={!query.isError}
          fallback={
            <ErrorState
              message={apiErrorMessage(query.error, "Couldn’t load your site’s health.")}
              onRetry={() => void query.refetch()}
            />
          }
        >
          <Show
            when={summary()}
            fallback={
              <EmptyState message="No health check yet. The daily scan fills this in shortly." />
            }
          >
            {(s) => (
              <>
                <LastChecked
                  checkedAt={s().checkedAt}
                  staleAfterMs={props.staleAfterMs ?? HEALTH_STALE_AFTER_MS}
                />

                {/* Pending schema migrations: the one problem an owner can't fix,
                  so it says who can, and names the files for them. Only shown
                  when there is one. */}
                <Show when={(s().pendingMigrations ?? []).length > 0}>
                  <section class="louise-settings-group">
                    <h3 class="louise-settings-title">Database updates</h3>
                    <p class="louise-muted">{pendingMessage(s().pendingMigrations!.length)}</p>
                    <div class="louise-list">
                      <For each={s().pendingMigrations}>
                        {(file) => (
                          <div class="louise-list-item">
                            <div class="louise-item-main">
                              <div class="louise-item-title">{file}</div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </section>
                </Show>

                {/* Broken links—listed for review; nothing to auto-fix here. */}
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
                  reviewer={altFix}
                  reviewLabel="Review in Media"
                  onReview={() => props.navigate({ panel: "media" })}
                  unavailableNote="AI descriptions aren’t set up for this site. Add them by hand in Media."
                />

                <AiFixSection
                  heading="Search engine info"
                  count={s().seoGaps}
                  message={`${count(s().seoGaps, "page")} missing an SEO title or description.`}
                  allClear="Every page has search info."
                  reviewer={seoFix}
                  reviewLabel="Review in Pages"
                  onReview={() => props.navigate({ panel: "pages" })}
                  unavailableNote="AI SEO isn’t set up for this site. Add titles/descriptions by hand in Pages."
                />

                <PerformanceSection cwv={s().cwv} />
              </>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}

/** When the last scan ran. Past the threshold it turns amber and says in words
 *  that it's out of date, so the warning doesn't rest on color alone (WCAG 1.4.1). */
function LastChecked(props: { checkedAt: string; staleAfterMs: number }) {
  const ago = () => timeAgo(props.checkedAt);
  return (
    <Show
      when={isStale(props.checkedAt, props.staleAfterMs)}
      fallback={
        <p class="louise-muted louise-settings-hint">Last checked {ago() || "recently"}.</p>
      }
    >
      <p class="louise-settings-hint louise-health-stale" data-state="stale">
        <strong>Out of date:</strong>{" "}
        {ago() ? `last checked ${ago()}.` : "there’s no record of when the last check ran."} The
        scheduled check might have stopped running. Ask your developer to look into it.
      </p>
    </Show>
  );
}

/** Owner wording for pending schema migrations: what it means and who fixes it. */
const pendingMessage = (n: number) =>
  n === 1
    ? "This version of the site needs a database update that hasn’t been applied, so some pages or saves might fail. Ask your developer to apply it:"
    : `This version of the site needs ${n} database updates that haven’t been applied, so some pages or saves might fail. Ask your developer to apply them:`;

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
            Not measured yet. Real-visitor speed appears here once traffic comes in.
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
  reviewer: Reviewer;
  reviewLabel: string;
  onReview: () => void;
  unavailableNote: string;
}) {
  const r = props.reviewer;
  return (
    <section class="louise-settings-group">
      <h3 class="louise-settings-title">{props.heading}</h3>
      <Show
        when={props.count > 0 || r.items().length > 0}
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
          <Show when={!r.unavailable() && r.items().length === 0}>
            <button
              class="louise-btn louise-btn-primary"
              type="button"
              disabled={r.suggesting()}
              onClick={() => void r.suggest()}
            >
              {r.suggesting() ? "Suggesting…" : "Suggest with AI"}
            </button>
          </Show>
          <button class="louise-btn" type="button" onClick={props.onReview}>
            {props.reviewLabel}
          </button>
        </div>
        {/* Each suggestion, editable, and nothing saved until Accept (#549). */}
        <Show when={r.items().length > 0}>
          <div class="louise-review">
            <div class="louise-review-head">
              <p class="louise-muted louise-settings-hint">
                Review each suggestion. Nothing changes until you accept it.
              </p>
              <button
                class="louise-btn louise-btn-primary"
                type="button"
                onClick={() => void r.acceptAll()}
              >
                Accept all
              </button>
            </div>
            <For each={r.items()}>
              {(item) => (
                <div class="louise-review-item">
                  <div class="louise-item-title">{item.label}</div>
                  <For each={item.fields}>
                    {(field) => {
                      const id = `louise-review-${item.id}-${field.name}`.replace(/[^\w-]/g, "-");
                      return (
                        <div class="louise-field">
                          <label for={id}>{field.label}</label>
                          <input
                            id={id}
                            class="louise-input"
                            value={field.value}
                            onInput={(e) => r.setValue(item.id, field.name, e.currentTarget.value)}
                          />
                        </div>
                      );
                    }}
                  </For>
                  <div class="louise-review-actions">
                    <button
                      class="louise-btn louise-btn-xs louise-btn-primary"
                      type="button"
                      aria-label={`Accept the suggestion for ${item.label}`}
                      onClick={() => void r.accept(item.id)}
                    >
                      Accept
                    </button>
                    <button
                      class="louise-btn louise-btn-xs"
                      type="button"
                      aria-label={`Skip the suggestion for ${item.label}`}
                      onClick={() => r.skip(item.id)}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={r.unavailable()}>
          <p class="louise-muted louise-settings-hint">{props.unavailableNote}</p>
        </Show>
        <p class="louise-muted louise-settings-hint" role="status">
          {r.notice() ?? ""}
        </p>
        <p class="louise-field-error" role="alert">
          {r.error() ?? ""}
        </p>
      </Show>
    </section>
  );
}
