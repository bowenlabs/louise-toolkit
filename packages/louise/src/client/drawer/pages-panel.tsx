// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// Framework Pages panel — CRUD over Louise-managed content pages (Terms,
// Privacy, and anything the owner creates), served publicly by the site's
// catch-all route. List ⇄ detail via an `editing` signal; the body is the
// shared RichText editor and stores sanitized HTML like every other rich field.
// Talks to the generic louisecms/editor `pages` route. Opened from the
// file-text icon in the drawer's top framework strip.
//
// A site may pass `builtInPages` — its code-defined routes (Home, About, …)
// that aren't `pages` rows but belong in the same list, each with an
// "Edit on page" deep link into inline edit mode.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { Icon } from "../icons.jsx";
import { RichText, type RichTextField } from "../RichText.jsx";
import { MediaUrlPicker } from "./fields.jsx";
import { apiSend, louiseQueryKey, louiseQueryKeys } from "./query.js";

/** A code-defined route listed alongside the CMS pages. */
export interface BuiltInPageRef {
  key: string;
  title: string;
  path: string;
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

export function PagesPanel(props: { builtInPages?: BuiltInPageRef[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = createSignal<PageRow | null>(null);

  const query = useQuery(() => ({
    queryKey: louiseQueryKeys.pages,
    queryFn: () => apiSend<{ pages: PageRow[] }>("GET", "/api/louise/pages").then((d) => d.pages),
  }));
  const list = () => query.data ?? [];

  const createMutation = useMutation(() => ({
    mutationFn: () =>
      apiSend<{ page: PageRow }>("POST", "/api/louise/pages", {
        title: "New page",
        slug: `new-page-${Date.now() % 100000}`,
      }),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: louiseQueryKeys.pages });
      setEditing(data.page);
    },
    onError: (err) => console.error("[louise]", err),
  }));

  return (
    <Switch
      fallback={
        <>
          <button
            class="louise-btn louise-btn-primary louise-btn-block"
            type="button"
            onClick={() => createMutation.mutate()}
          >
            + New page
          </button>
          <div style={{ height: "14px" }} />
          <Show when={!query.isLoading} fallback={<p class="louise-muted">Loading…</p>}>
            <Show when={list().length > 0} fallback={<p class="louise-muted">No pages yet.</p>}>
              <div class="louise-list">
                <For each={list()}>
                  {(p) => (
                    <div class="louise-list-item">
                      <div class="louise-item-main">
                        <div class="louise-item-title">{p.title}</div>
                        <div class="louise-item-sub">
                          /{p.slug} · {p.status === "published" ? "Published" : "Draft"}
                        </div>
                      </div>
                      <button class="louise-btn" type="button" onClick={() => setEditing(p)}>
                        Open
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
          onDone={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: louiseQueryKeys.pages });
          }}
        />
      </Match>
    </Switch>
  );
}

function PageForm(props: { page: PageRow; onDone: () => void }) {
  const p = props.page;
  const qc = useQueryClient();
  const [title, setTitle] = createSignal(p.title ?? "");
  const [slug, setSlug] = createSignal(p.slug ?? "");
  const [status, setStatus] = createSignal<PageRow["status"]>(p.status ?? "draft");
  const [seoTitle, setSeoTitle] = createSignal(p.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = createSignal(p.seoDescription ?? "");
  const [ogImage, setOgImage] = createSignal(p.ogImage ?? "");
  const [noindex, setNoindex] = createSignal(Boolean(p.noindex));
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  // Fetch the fresh row rather than trusting the (possibly stale) cached list
  // item — the body especially may have been saved since the list loaded. The
  // editor mounts only once the fresh row is in (initialDoc isn't reactive).
  const detail = useQuery(() => ({
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
      return row;
    },
    // The editor's initialDoc isn't reactive, so the form must always mount
    // against a FRESH row: no cache reuse between opens.
    staleTime: 0,
    gcTime: 0,
  }));

  let rt: RichTextField | undefined;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiSend(`PATCH`, `/api/louise/pages/${p.id}`, {
        title: title(),
        slug: slug(),
        status: status(),
        seoTitle: seoTitle(),
        seoDescription: seoDescription(),
        ogImage: ogImage(),
        noindex: noindex(),
        body: rt?.getHTML() ?? detail.data?.body ?? p.body ?? "",
      });
      props.onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save");
    }
    setSaving(false);
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

  return (
    <div>
      <button class="louise-btn" type="button" onClick={props.onDone}>
        ← All pages
      </button>
      <div style={{ height: "14px" }} />

      <div class="louise-grid-2">
        <div class="louise-field">
          <label for="pg-title">Title</label>
          <input
            id="pg-title"
            class="louise-input"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
          />
        </div>
        <div class="louise-field">
          <label for="pg-slug">Path</label>
          <input
            id="pg-slug"
            class="louise-input"
            value={slug()}
            onInput={(e) => setSlug(e.currentTarget.value)}
            placeholder="about-the-studio"
          />
        </div>
      </div>

      <div class="louise-field">
        <span class="louise-field-label">Body</span>
        <Show when={!detail.isLoading} fallback={<p class="louise-muted">Loading…</p>}>
          <RichText initialDoc={detail.data?.body ?? undefined} blocks ref={(f) => (rt = f)} />
        </Show>
      </div>

      <div class="louise-grid-2">
        <div class="louise-field">
          <label for="pg-status">Status</label>
          <select
            id="pg-status"
            class="louise-select"
            value={status()}
            onChange={(e) => setStatus(e.currentTarget.value as PageRow["status"])}
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
            onChange={(e) => setNoindex(e.currentTarget.value === "noindex")}
          >
            <option value="index">Indexable</option>
            <option value="noindex">Hidden (noindex)</option>
          </select>
        </div>
      </div>

      <div class="louise-grid-2">
        <div class="louise-field">
          <label for="pg-seo-title">SEO title (optional)</label>
          <input
            id="pg-seo-title"
            class="louise-input"
            value={seoTitle()}
            onInput={(e) => setSeoTitle(e.currentTarget.value)}
          />
        </div>
        <div class="louise-field">
          <label for="pg-seo-desc">SEO description (optional)</label>
          <input
            id="pg-seo-desc"
            class="louise-input"
            value={seoDescription()}
            onInput={(e) => setSeoDescription(e.currentTarget.value)}
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
          onInput={(e) => setOgImage(e.currentTarget.value)}
        />
        <MediaUrlPicker onPick={(url) => setOgImage(url)} />
      </div>

      <Show when={error()}>
        <div class="louise-alert" role="alert">
          {error()}
        </div>
      </Show>

      <div class="louise-form-actions">
        <button
          class="louise-btn louise-btn-primary"
          type="button"
          disabled={saving()}
          onClick={() => void save()}
        >
          {saving() ? "Saving…" : "Save page"}
        </button>
        <Show when={status() === "published" && slug()}>
          <a class="louise-btn" href={`/${slug()}`} target="_blank" rel="noreferrer">
            View
          </a>
        </Show>
        <button class="louise-btn louise-btn-danger" type="button" onClick={() => void remove()}>
          <Icon name="trash" /> Delete
        </button>
      </div>
    </div>
  );
}
