// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework Pages panel—CRUD over Louise-managed content pages (Terms,
// Privacy, and anything the owner creates), served publicly by the site's
// catch-all route. List ⇄ detail via an `editing` signal; the body is the
// shared RichText editor and stores sanitized HTML like every other rich field.
// Talks to the generic louise-toolkit/editor `pages` route. Opened from the
// file-text icon in the Settings' top framework strip.
//
// A site may pass `builtInPages`—its code-defined routes (Home, About, …)
// that aren't `pages` rows but belong in the same list, each with an
// "Edit on page" deep link into inline edit mode.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import type { OgCardOptions } from "../../core/browser/og-card.js";
import { pageState } from "../../core/content/lifecycle.js";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "../../core/seo/limits.js";
import { Icon } from "../icons.jsx";
import { EmptyState, ErrorState, Skeleton } from "../states.jsx";
import { MediaUrlPicker } from "./fields.jsx";
import { OgPreview } from "./og-preview.jsx";
import { type SaveStatus, usePanelActions } from "./panel-actions.jsx";
import { apiErrorMessage, apiGet, apiSend, louiseQueryKey, louiseQueryKeys } from "./query.js";

/** A code-defined route listed alongside the content pages. */
export interface BuiltInPageRef {
  key: string;
  title: string;
  path: string;
}

/** A starter layout offered under "New page from template"—canned block HTML
 *  (sanitized on save like any page body); no schema change. */
export interface PageTemplate {
  /** Stable id. */
  id: string;
  /** Button label. */
  label: string;
  /** Prefilled page title (defaults to `label`). */
  title?: string;
  /** Prefilled builder body (HTML). */
  body: string;
}

/** A row of the site's `pages` table (the fields the panel edits). */
export interface PageRow {
  id: number;
  slug: string;
  title: string;
  body: string | null;
  status: "draft" | "published";
  /** Present when the page has drafts: the version its row holds. Its presence
   *  is what tells the panel to publish and unpublish rather than set status. */
  publishedVersionId?: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  noindex: boolean;
  sortOrder: number | null;
}

/** Whether the page publishes through drafts (ADR 0021): its row carries the
 *  pointer column, and only publish and unpublish change who sees it. */
const hasDrafts = (p: Pick<PageRow, "publishedVersionId">): boolean => "publishedVersionId" in p;

/** A page's visibility in words: live, hidden, or never published. */
function visibilityLabel(p: Pick<PageRow, "status" | "publishedVersionId">): string {
  if (!hasDrafts(p)) return p.status === "published" ? "Live" : "Hidden";
  const state = pageState(p);
  return state === "live" ? "Live" : state === "hidden" ? "Hidden" : "Not published";
}

export function PagesPanel(props: {
  builtInPages?: BuiltInPageRef[];
  pageTemplates?: PageTemplate[];
  /** Match the live share-card preview to the site's real OG card (brand,
   *  colours, footer, font). Omit for the toolkit's default card; pass `false`
   *  when the site renders no cards, so the preview falls back to the default
   *  share image the way a real share does. */
  ogCard?: OgCardOptions | false;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = createSignal<PageRow | null>(null);

  const query = useQuery(() => ({
    queryKey: louiseQueryKeys.pages,
    queryFn: () => apiSend<{ pages: PageRow[] }>("GET", "/api/louise/pages").then((d) => d.pages),
  }));
  const list = () => query.data ?? [];

  // Full-text search over pages (title/body/sections). Non-empty query swaps the
  // list for ranked matches from /api/louise/pages/search.
  const [q, setQ] = createSignal("");
  const searchQuery = useQuery(() => ({
    queryKey: [...louiseQueryKeys.pages, "search", q().trim()],
    queryFn: () => {
      const term = q().trim();
      if (!term) return Promise.resolve([] as PageRow[]);
      return apiSend<{ results: PageRow[] }>(
        "GET",
        `/api/louise/pages/search?q=${encodeURIComponent(term)}`,
      ).then((d) => d.results);
    },
  }));
  const searching = () => q().trim().length > 0;
  const shown = () => (searching() ? (searchQuery.data ?? []) : list());
  // How many pages match, read out as the owner types (#468). Empty at rest,
  // and while the search is still running.
  const matchCount = () => {
    if (!searching() || searchQuery.isFetching) return "";
    const n = shown().length;
    return n === 0 ? "No pages match" : `${n} ${n === 1 ? "page matches" : "pages match"}`;
  };

  const createMutation = useMutation(() => ({
    mutationFn: (input: { title: string; slug: string; body?: string }) =>
      apiSend<{ page: PageRow }>("POST", "/api/louise/pages", input),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: louiseQueryKeys.pages });
      // Jump straight to the new page's canvas—content is built in place, not
      // in the Settings.
      window.location.href = `/${data.page.slug}?louise`;
    },
    onError: (err) => console.error("[louise]", err),
  }));
  const newSlug = () => `new-page-${Date.now() % 100000}`;
  const createBlank = () => createMutation.mutate({ title: "New page", slug: newSlug() });
  const createFromTemplate = (t: PageTemplate) =>
    createMutation.mutate({ title: t.title ?? t.label, slug: newSlug(), body: t.body });

  return (
    <Switch
      fallback={
        <>
          <button
            class="louise-btn louise-btn-primary louise-btn-block"
            type="button"
            onClick={createBlank}
          >
            + New page
          </button>
          <Show when={(props.pageTemplates ?? []).length > 0}>
            <div class="louise-tpl-row">
              <span class="louise-muted louise-settings-hint">Or start from a template:</span>
              <div class="louise-tpl-buttons">
                <For each={props.pageTemplates}>
                  {(t) => (
                    <button class="louise-btn" type="button" onClick={() => createFromTemplate(t)}>
                      {t.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <div style={{ height: "14px" }} />
          <input
            class="louise-input louise-pages-search"
            type="search"
            aria-label="Search pages"
            placeholder="Search pages…"
            value={q()}
            onInput={(e) => setQ(e.currentTarget.value)}
            aria-describedby="louise-pages-match-count"
          />
          <p id="louise-pages-match-count" class="louise-muted louise-settings-hint" role="status">
            {matchCount()}
          </p>
          <Show
            when={!query.isLoading}
            fallback={<Skeleton label="Loading your pages" count={4} />}
          >
            <Show
              when={!query.isError}
              fallback={
                <ErrorState
                  message={apiErrorMessage(query.error, "Couldn’t load your pages.")}
                  onRetry={() => void query.refetch()}
                />
              }
            >
              <Show
                when={shown().length > 0}
                fallback={
                  <EmptyState message={searching() ? "No pages match." : "No pages yet."} />
                }
              >
                <div class="louise-list">
                  <For each={shown()}>
                    {(p) => (
                      <div class="louise-list-item">
                        <div class="louise-item-main">
                          <div class="louise-item-title">{p.title}</div>
                          <div class="louise-item-sub">
                            /{p.slug} · {visibilityLabel(p)}
                          </div>
                        </div>
                        {/* Edit content on the page canvas; the gear opens page settings. */}
                        <a class="louise-btn" href={`/${p.slug}?louise`}>
                          Edit
                        </a>
                        <button
                          class="louise-btn"
                          type="button"
                          aria-label="Page settings"
                          title="Page settings"
                          onClick={() => setEditing(p)}
                        >
                          <Icon name="gear" />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>

          <Show when={(props.builtInPages ?? []).length > 0}>
            <section class="louise-settings-group louise-settings-session">
              <h3 class="louise-settings-title">Built-in pages</h3>
              <p class="louise-muted louise-settings-hint">
                Fixed pages defined in code. Edit their text on the page itself.
              </p>
              <div class="louise-list">
                <For each={props.builtInPages}>
                  {(p) => (
                    <div class="louise-list-item">
                      <div class="louise-item-main">
                        <div class="louise-item-title">{p.title}</div>
                        <div class="louise-item-sub">{p.path}</div>
                      </div>
                      <a class="louise-btn" href={`${p.path}?louise`}>
                        Edit on page
                      </a>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </Show>
        </>
      }
    >
      <Match when={editing()}>
        <PageForm
          page={editing() as PageRow}
          ogCard={props.ogCard}
          onDone={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: louiseQueryKeys.pages });
          }}
        />
      </Match>
    </Switch>
  );
}

/** "12 of 60 characters", and past the limit, that search results cut it off. */
function lengthHint(length: number, max: number): string {
  const count = `${length} of ${max} characters`;
  return length > max ? `${count}. Search results cut off the rest.` : count;
}

function PageForm(props: { page: PageRow; onDone: () => void; ogCard?: OgCardOptions | false }) {
  const p = props.page;
  const qc = useQueryClient();
  const actions = usePanelActions();
  const [title, setTitle] = createSignal(p.title ?? "");
  const [slug, setSlug] = createSignal(p.slug ?? "");
  const [status, setStatus] = createSignal<PageRow["status"]>(p.status ?? "draft");
  // The fresh row's pointer, for a page with drafts (see `hasDrafts`).
  const [pointer, setPointer] = createSignal<Pick<PageRow, "publishedVersionId">>(
    hasDrafts(p) ? { publishedVersionId: p.publishedVersionId ?? null } : {},
  );
  const [visibilityBusy, setVisibilityBusy] = createSignal(false);
  const [seoTitle, setSeoTitle] = createSignal(p.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = createSignal(p.seoDescription ?? "");
  const [ogImage, setOgImage] = createSignal(p.ogImage ?? "");
  const [noindex, setNoindex] = createSignal(Boolean(p.noindex));
  const [error, setError] = createSignal<string | null>(null);
  // The site-wide default share image, so the preview falls back to it the way
  // a real share does. Its own key under `settings`, so a Settings save, which
  // invalidates that prefix, refreshes it too.
  const shareDefaults = useQuery(() => ({
    queryKey: [...louiseQueryKeys.settings, "share"],
    queryFn: async () => {
      const data = await apiGet<{ settings?: Record<string, unknown> }>("/api/louise/settings");
      const image = data.settings?.defaultOgImageUrl;
      return typeof image === "string" ? image : "";
    },
  }));
  // Page body HTML, kept only to feed the AI SEO suggestion (#75/#166)—not an
  // editable field here (content is edited on the canvas). Refreshed from the row.
  const [bodyHtml, setBodyHtml] = createSignal(p.body ?? "");
  // AI SEO "suggest" (#75/#166): opt-in, degrade-gracefully. `seoAvailable` starts
  // true and flips off on the first 503 (the AI binding isn't provisioned).
  const [seoBusy, setSeoBusy] = createSignal(false);
  const [seoAvailable, setSeoAvailable] = createSignal(true);
  // The footer Save is dirty-gated. A fresh load (below) and a successful save
  // clear it; every field edit sets it via `edited`.
  const [dirty, setDirty] = createSignal(false);
  const edited =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setDirty(true);
    };

  // Populate the settings fields from a fresh row (the cached list item may be
  // stale). The body is intentionally not read here—content lives on the canvas.
  useQuery(() => ({
    queryKey: louiseQueryKey("pages", p.id),
    queryFn: async () => {
      const data = await apiSend<{ page: PageRow }>("GET", `/api/louise/pages/${p.id}`);
      const row = data.page;
      setTitle(row.title ?? "");
      setSlug(row.slug ?? "");
      setStatus(row.status ?? "draft");
      setPointer(hasDrafts(row) ? { publishedVersionId: row.publishedVersionId ?? null } : {});
      setSeoTitle(row.seoTitle ?? "");
      setSeoDescription(row.seoDescription ?? "");
      setOgImage(row.ogImage ?? "");
      setNoindex(Boolean(row.noindex));
      setBodyHtml(row.body ?? "");
      setDirty(false);
      return row;
    },
    // The editor's initialDoc isn't reactive, so the form must always mount
    // against a FRESH row: no cache reuse between opens.
    staleTime: 0,
    gcTime: 0,
  }));

  // A status for the footer pill: Save with nothing changed says so.
  const [notice, setNotice] = createSignal<string | null>(null);
  const save = async () => {
    setError(null);
    if (!dirty()) {
      setNotice("No changes to save");
      return;
    }
    setNotice(null);
    try {
      // Settings only—the body is edited (and saved) on the page canvas, so it
      // is intentionally omitted here to never clobber in-place content edits.
      await apiSend(`PATCH`, `/api/louise/pages/${p.id}`, {
        title: title(),
        slug: slug(),
        // A page with drafts goes live through Publish, never its status (ADR 0021).
        ...(hasDrafts(pointer()) ? {} : { status: status() }),
        seoTitle: seoTitle(),
        seoDescription: seoDescription(),
        ogImage: ogImage(),
        noindex: noindex(),
      });
      setDirty(false);
      props.onDone();
    } catch (err) {
      console.error("[louise]", err);
      // The route's own reason, such as a reserved slug, never the request line.
      setError(apiErrorMessage(err, "Couldn’t save"));
    }
  };

  // Publish or unpublish a page with drafts, straight away. Publish puts the
  // newest pending draft live, or shows a hidden page again as it stands.
  const setVisibility = async (action: "publish" | "unpublish") => {
    setError(null);
    setVisibilityBusy(true);
    try {
      const data = await apiSend<{ page: PageRow }>(
        "POST",
        `/api/louise/pages/${p.id}/${action}`,
        {},
      );
      setStatus(data.page.status ?? (action === "publish" ? "published" : "draft"));
      setPointer({ publishedVersionId: data.page.publishedVersionId ?? null });
      await qc.invalidateQueries({ queryKey: louiseQueryKeys.pages });
    } catch (err) {
      console.error("[louise]", err);
      setError(
        apiErrorMessage(err, action === "publish" ? "Couldn’t publish" : "Couldn’t unpublish"),
      );
    } finally {
      setVisibilityBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete “${title() || p.title}”? The public page goes away immediately.`)) return;
    try {
      await apiSend("DELETE", `/api/louise/pages/${p.id}`);
      await qc.invalidateQueries({ queryKey: louiseQueryKeys.pages });
      props.onDone();
    } catch (err) {
      console.error("[louise]", err);
      setError(apiErrorMessage(err, "Couldn’t delete"));
    }
  };

  // AI SEO suggestion (#75/#166): POST the page's title + body text to
  // /api/louise/ai/seo and pre-fill the SEO fields for review. The fields are
  // set through `edited(...)` so they mark the form dirty—the suggestion is
  // never auto-committed; the owner still presses Save. Degrades quietly: a 503
  // (no AI binding) retires the button; a 502/model hiccup shows a soft notice.
  const suggestSeo = async () => {
    // Flatten the body HTML to plain text for the prompt (the server caps length).
    const bodyText = bodyHtml()
      ? (new DOMParser().parseFromString(bodyHtml(), "text/html").body.textContent ?? "")
      : "";
    const content = [title(), bodyText].filter(Boolean).join("\n\n").trim();
    if (!content) return;
    setError(null);
    setSeoBusy(true);
    try {
      const res = await fetch("/api/louise/ai/seo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.status === 503) {
        setSeoAvailable(false);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { reason?: unknown } | null;
        setError(
          data?.reason === "rate-limited"
            ? "AI is busy right now. Try again in a minute. Your fields are as you left them."
            : "Couldn’t suggest SEO right now. Your fields are as you left them.",
        );
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        title?: string | null;
        description?: string | null;
      } | null;
      if (data?.title) edited(setSeoTitle)(data.title);
      if (data?.description) edited(setSeoDescription)(data.description);
    } catch {
      setError("Couldn’t suggest SEO right now. Your fields are as you left them.");
    } finally {
      setSeoBusy(false);
    }
  };

  // Page-settings Save/Delete live in the drawer footer (the deepest active view
  // in the Pages panel), so they're always in reach while the form scrolls.
  onMount(() =>
    onCleanup(
      actions.push(
        [
          // Enabled with nothing changed, so it stays in the tab order and
          // Cmd+S answers; `save` says there's nothing to save.
          { id: "save", label: "Save", kind: "primary", busyLabel: "Saving…", onClick: save },
          { id: "delete", label: "Delete", kind: "danger", onClick: remove },
        ],
        (): SaveStatus => {
          const message = notice();
          return message ? { state: "notice", message } : { state: "idle" };
        },
      ),
    ),
  );

  return (
    <div>
      <button class="louise-btn" type="button" onClick={props.onDone}>
        ← All pages
      </button>
      <div style={{ height: "14px" }} />

      <div class="louise-field">
        <span class="louise-field-label">Content</span>
        <a class="louise-btn louise-btn-primary louise-btn-block" href={`/${slug()}?louise`}>
          Edit content on the page →
        </a>
        <p class="louise-muted louise-settings-hint">
          Build this page’s layout and text directly on the page. These are its settings.
        </p>
      </div>

      <div class="louise-grid-2">
        <div class="louise-field">
          <label for="pg-title">Title</label>
          <input
            id="pg-title"
            class="louise-input"
            value={title()}
            onInput={(e) => edited(setTitle)(e.currentTarget.value)}
          />
        </div>
        <div class="louise-field">
          <label for="pg-slug">Path</label>
          <input
            id="pg-slug"
            class="louise-input"
            value={slug()}
            onInput={(e) => edited(setSlug)(e.currentTarget.value)}
            placeholder="about-the-studio"
          />
        </div>
      </div>

      <div class="louise-grid-2">
        <Show
          when={hasDrafts(pointer())}
          fallback={
            <div class="louise-field">
              <label for="pg-status">Status</label>
              <select
                id="pg-status"
                class="louise-select"
                value={status()}
                onChange={(e) => edited(setStatus)(e.currentTarget.value as PageRow["status"])}
              >
                <option value="draft">Hidden</option>
                <option value="published">Live</option>
              </select>
            </div>
          }
        >
          {/* A page with drafts: its visibility is an action, not a field to save. */}
          <div class="louise-field" role="group" aria-labelledby="pg-visibility-label">
            <span id="pg-visibility-label" class="louise-field-label">
              Visibility
            </span>
            <p class="louise-settings-hint" role="status">
              {visibilityLabel({ status: status(), ...pointer() })}
            </p>
            <Show
              when={status() === "published"}
              fallback={
                <button
                  class="louise-btn louise-btn-primary"
                  type="button"
                  disabled={visibilityBusy()}
                  onClick={() => void setVisibility("publish")}
                >
                  Publish
                </button>
              }
            >
              <button
                class="louise-btn"
                type="button"
                disabled={visibilityBusy()}
                onClick={() => void setVisibility("unpublish")}
              >
                Unpublish
              </button>
            </Show>
          </div>
        </Show>
        <div class="louise-field">
          <label for="pg-noindex">Search engines</label>
          <select
            id="pg-noindex"
            class="louise-select"
            value={noindex() ? "noindex" : "index"}
            onChange={(e) => edited(setNoindex)(e.currentTarget.value === "noindex")}
          >
            <option value="index">Indexable</option>
            <option value="noindex">Hidden (noindex)</option>
          </select>
        </div>
      </div>

      <div class="louise-seo-head">
        <span class="louise-field-label">Search engine listing</span>
        {/* Hidden once we learn the AI binding is absent (first 503). */}
        <Show when={seoAvailable()}>
          <button
            type="button"
            class="louise-btn louise-btn-ai"
            disabled={seoBusy()}
            onClick={suggestSeo}
          >
            <Icon name="sparkle" />
            {seoBusy() ? "Suggesting…" : "Suggest"}
          </button>
        </Show>
      </div>

      <div class="louise-grid-2">
        <div class="louise-field">
          <label for="pg-seo-title">SEO title (optional)</label>
          <input
            id="pg-seo-title"
            class="louise-input"
            aria-describedby="pg-seo-title-count"
            value={seoTitle()}
            onInput={(e) => edited(setSeoTitle)(e.currentTarget.value)}
          />
          <p id="pg-seo-title-count" class="louise-muted louise-settings-hint">
            {lengthHint(seoTitle().length, SEO_TITLE_MAX)}
          </p>
        </div>
        <div class="louise-field">
          <label for="pg-seo-desc">SEO description (optional)</label>
          <input
            id="pg-seo-desc"
            class="louise-input"
            aria-describedby="pg-seo-desc-count"
            value={seoDescription()}
            onInput={(e) => edited(setSeoDescription)(e.currentTarget.value)}
          />
          <p id="pg-seo-desc-count" class="louise-muted louise-settings-hint">
            {lengthHint(seoDescription().length, SEO_DESCRIPTION_MAX)}
          </p>
        </div>
      </div>

      <div class="louise-field">
        <label for="pg-seo-og">Social image (optional)</label>
        <input
          id="pg-seo-og"
          class="louise-input"
          value={ogImage()}
          placeholder="https://…/share.jpg"
          onInput={(e) => edited(setOgImage)(e.currentTarget.value)}
        />
        <MediaUrlPicker onPick={edited(setOgImage)} />
      </div>

      <OgPreview
        customImage={ogImage()}
        title={seoTitle() || title()}
        cardOptions={props.ogCard || undefined}
        share={{ cards: props.ogCard !== false, defaultImage: shareDefaults.data ?? "" }}
      />

      <Show when={error()}>
        <div class="louise-alert" role="alert">
          {error()}
        </div>
      </Show>

      {/* Save/Delete live in the drawer footer; only the preview link stays inline. */}
      <Show when={status() === "published" && slug()}>
        <div class="louise-form-actions">
          {/* Says it opens a new tab, in words (#598); the icon repeats it for
              sighted owners and stays out of the accessible name. */}
          <a class="louise-btn" href={`/${slug()}`} target="_blank" rel="noreferrer">
            View published page (opens in a new tab) <Icon name="arrowSquareOut" />
          </a>
        </div>
      </Show>
    </div>
  );
}
