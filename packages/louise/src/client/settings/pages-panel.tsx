// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework Pages panel — CRUD over Louise-managed content pages (Terms,
// Privacy, and anything the owner creates), served publicly by the site's
// catch-all route. List ⇄ detail via an `editing` signal; the body is the
// shared RichText editor and stores sanitized HTML like every other rich field.
// Talks to the generic louise-toolkit/editor `pages` route. Opened from the
// file-text icon in the Settings' top framework strip.
//
// A site may pass `builtInPages` — its code-defined routes (Home, About, …)
// that aren't `pages` rows but belong in the same list, each with an
// "Edit on page" deep link into inline edit mode.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import type { OgCardOptions } from "../../core/browser/og-card.js";
import { Icon } from "../icons.jsx";
import { MediaUrlPicker } from "./fields.jsx";
import { OgPreview } from "./og-preview.jsx";
import { usePanelActions } from "./panel-actions.jsx";
import { apiSend, louiseQueryKey, louiseQueryKeys } from "./query.js";

/** A code-defined route listed alongside the content pages. */
export interface BuiltInPageRef {
  key: string;
  title: string;
  path: string;
}

/** A starter layout offered under "New page from template" — canned block HTML
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
  seoTitle: string | null;
  seoDescription: string | null;
  ogImage: string | null;
  noindex: boolean;
  sortOrder: number | null;
}

export function PagesPanel(props: {
  builtInPages?: BuiltInPageRef[];
  pageTemplates?: PageTemplate[];
  /** Match the live share-card preview to the site's real OG card (brand,
   *  colours, footer, font). Omit for the toolkit's default card. */
  ogCard?: OgCardOptions;
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

  const createMutation = useMutation(() => ({
    mutationFn: (input: { title: string; slug: string; body?: string }) =>
      apiSend<{ page: PageRow }>("POST", "/api/louise/pages", input),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: louiseQueryKeys.pages });
      // Jump straight to the new page's canvas — content is built in place, not
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
            placeholder="Search pages…"
            value={q()}
            onInput={(e) => setQ(e.currentTarget.value)}
          />
          <Show when={!query.isLoading} fallback={<p class="louise-muted">Loading…</p>}>
            <Show
              when={shown().length > 0}
              fallback={<p class="louise-muted">{searching() ? "No matches." : "No pages yet."}</p>}
            >
              <div class="louise-list">
                <For each={shown()}>
                  {(p) => (
                    <div class="louise-list-item">
                      <div class="louise-item-main">
                        <div class="louise-item-title">{p.title}</div>
                        <div class="louise-item-sub">
                          /{p.slug} · {p.status === "published" ? "Published" : "Draft"}
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

          <Show when={(props.builtInPages ?? []).length > 0}>
            <section class="louise-settings-group louise-settings-session">
              <h3 class="louise-settings-title">Built-in pages</h3>
              <p class="louise-muted louise-settings-hint">
                Fixed pages defined in code — edit their text on the page itself.
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

function PageForm(props: { page: PageRow; onDone: () => void; ogCard?: OgCardOptions }) {
  const p = props.page;
  const qc = useQueryClient();
  const actions = usePanelActions();
  const [title, setTitle] = createSignal(p.title ?? "");
  const [slug, setSlug] = createSignal(p.slug ?? "");
  const [status, setStatus] = createSignal<PageRow["status"]>(p.status ?? "draft");
  const [seoTitle, setSeoTitle] = createSignal(p.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = createSignal(p.seoDescription ?? "");
  const [ogImage, setOgImage] = createSignal(p.ogImage ?? "");
  const [noindex, setNoindex] = createSignal(Boolean(p.noindex));
  const [error, setError] = createSignal<string | null>(null);
  // Page body HTML, kept only to feed the AI SEO suggestion (#75/#166) — not an
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
  // stale). The body is intentionally not read here — content lives on the canvas.
  useQuery(() => ({
    queryKey: louiseQueryKey("pages", p.id),
    queryFn: async () => {
      const data = await apiSend<{ page: PageRow }>("GET", `/api/louise/pages/${p.id}`);
      const row = data.page;
      setTitle(row.title ?? "");
      setSlug(row.slug ?? "");
      setStatus(row.status ?? "draft");
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

  const save = async () => {
    setError(null);
    try {
      // Settings only — the body is edited (and saved) on the page canvas, so it
      // is intentionally omitted here to never clobber in-place content edits.
      await apiSend(`PATCH`, `/api/louise/pages/${p.id}`, {
        title: title(),
        slug: slug(),
        status: status(),
        seoTitle: seoTitle(),
        seoDescription: seoDescription(),
        ogImage: ogImage(),
        noindex: noindex(),
      });
      setDirty(false);
      props.onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save");
    }
  };

  const remove = async () => {
    if (!confirm(`Delete “${title() || p.title}”? The public page goes away immediately.`)) return;
    try {
      await apiSend("DELETE", `/api/louise/pages/${p.id}`);
      await qc.invalidateQueries({ queryKey: louiseQueryKeys.pages });
      props.onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t delete");
    }
  };

  // AI SEO suggestion (#75/#166): POST the page's title + body text to
  // /api/louise/ai/seo and pre-fill the SEO fields for review. The fields are
  // set through `edited(...)` so they mark the form dirty — the suggestion is
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
        setError("Couldn’t suggest SEO right now — leaving your fields as they are.");
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        title?: string | null;
        description?: string | null;
      } | null;
      if (data?.title) edited(setSeoTitle)(data.title);
      if (data?.description) edited(setSeoDescription)(data.description);
    } catch {
      setError("Couldn’t suggest SEO right now — leaving your fields as they are.");
    } finally {
      setSeoBusy(false);
    }
  };

  // Page-settings Save/Delete live in the drawer footer (the deepest active view
  // in the Pages panel), so they're always in reach while the form scrolls.
  onMount(() =>
    onCleanup(
      actions.push([
        {
          id: "save",
          label: "Save",
          kind: "primary",
          busyLabel: "Saving…",
          disabled: () => !dirty(),
          onClick: save,
        },
        { id: "delete", label: "Delete", kind: "danger", onClick: remove },
      ]),
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
        <div class="louise-field">
          <label for="pg-status">Status</label>
          <select
            id="pg-status"
            class="louise-select"
            value={status()}
            onChange={(e) => edited(setStatus)(e.currentTarget.value as PageRow["status"])}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
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
            value={seoTitle()}
            onInput={(e) => edited(setSeoTitle)(e.currentTarget.value)}
          />
        </div>
        <div class="louise-field">
          <label for="pg-seo-desc">SEO description (optional)</label>
          <input
            id="pg-seo-desc"
            class="louise-input"
            value={seoDescription()}
            onInput={(e) => edited(setSeoDescription)(e.currentTarget.value)}
          />
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

      <OgPreview customImage={ogImage()} title={seoTitle() || title()} cardOptions={props.ogCard} />

      <Show when={error()}>
        <div class="louise-alert" role="alert">
          {error()}
        </div>
      </Show>

      {/* Save/Delete live in the drawer footer; only the preview link stays inline. */}
      <Show when={status() === "published" && slug()}>
        <div class="louise-form-actions">
          <a class="louise-btn" href={`/${slug()}`} target="_blank" rel="noreferrer">
            View published page →
          </a>
        </div>
      </Show>
    </div>
  );
}
