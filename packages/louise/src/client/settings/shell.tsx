// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The Louise Settings shell — a SolidJS overlay summoned in edit mode: the
// command centre for structured/back-office work the inline surface can't do.
// Rendered over the live page, not a separate admin app.
//
// Two groups, and the split is first-class in the registry API so a site can't
// accidentally collapse it:
//   • TOP strip — the framework panels Pages / Media / Settings. Fixed and
//     shell-owned; near-identical on every Louise site, so sites neither
//     register nor reorder them. Settings alone is extensible, via its
//     declarative extension groups + an escape-hatch `settingsExtras` slot.
//   • BOTTOM tabs — the site's own collections (`config.tabs`), whose shape and
//     display vary per site. Inquiries is a Louise base table but a per-site
//     display, so it ships as a registerable tab (InquiriesPanel), not a fixed
//     panel.
//
// The root carries data-theme="louise" so Louise Settings runs under the Louise
// theme while the page around it stays on the site's own theme.

import { QueryClientProvider } from "@tanstack/solid-query";
import { createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import { Icon } from "../icons.jsx";
import { injectStyles } from "../styles.js";
import type { SettingsFieldGroup } from "./fields.jsx";
import { MediaPanel } from "./media-panel.jsx";
import { type BuiltInPageRef, type PageTemplate, PagesPanel } from "./pages-panel.jsx";
import { createSettingsQueryClient } from "./query.js";
import { SettingsPanel } from "./settings-panel.jsx";
import { UsersPanel } from "./users-panel.jsx";

/** Event the edit-bar's Settings action fires to open Louise Settings. */
export const OPEN_SETTINGS_EVENT = "louise:open-settings";

/** A site-registered collection tab (the BOTTOM group). The framework panels are
 *  not `CollectionTab`s — they're fixed in the top strip and can't be added here. */
export interface CollectionTab {
  /** Stable id (sites typically reuse it as a query-key segment). */
  id: string;
  /** Tab label shown in the bottom nav. */
  label: string;
  /** The panel body, rendered when this tab is active. */
  panel: () => JSX.Element;
}

export interface SettingsConfig {
  /** Editor display name shown in the Louise Settings header. */
  userName: string;
  /** Site-registered collection tabs (bottom group). The framework panels
   *  (Pages/Media/Settings) are fixed and shell-owned — not part of this list. */
  tabs?: CollectionTab[];
  /** Code-defined routes listed in the framework Pages panel. */
  builtInPages?: BuiltInPageRef[];
  /** Starter layouts offered under "New page from template" in the Pages panel. */
  pageTemplates?: PageTemplate[];
  /** Override which framework Settings groups render. Omit for the defaults;
   *  pass a subset (or `[]`) so a site whose settings don't map to
   *  `siteSettingsColumns` shows no empty base fields — its config lives in
   *  `settingsExtension` instead. */
  settingsBaseGroups?: SettingsFieldGroup[];
  /** Site-specific settings groups rendered inside the framework Settings panel. */
  settingsExtension?: SettingsFieldGroup[];
  /** Bespoke Settings sections (e.g. passkey enrollment) that self-persist. */
  settingsExtras?: () => JSX.Element;
  /** Show the Users panel (louise editor/admin management) in the top strip.
   *  Opt-in: wire `editorsRoute` server-side for it to talk to. */
  users?: boolean;
  /** Override the Users panel editors endpoint. Default `/api/louise/editors`. */
  usersEndpoint?: string;
}

/** The framework panels, keyed by their top-strip icon. Media/Pages/Settings
 *  are always present; `users` is opt-in (config.users + a wired editorsRoute). */
type FrameworkPanel = "users" | "media" | "pages" | "settings";
const BASE_FRAMEWORK_BUTTONS: {
  id: FrameworkPanel;
  label: string;
  icon: "user" | "image" | "fileText" | "gear";
}[] = [
  { id: "media", label: "Media", icon: "image" },
  { id: "pages", label: "Pages", icon: "fileText" },
  { id: "settings", label: "Settings", icon: "gear" },
];

export function Settings(props: SettingsConfig) {
  const tabs = () => props.tabs ?? [];
  // The top strip: Media/Pages/Settings always, Users first when opted in.
  const frameworkButtons = () =>
    props.users
      ? [{ id: "users" as const, label: "Users", icon: "user" as const }, ...BASE_FRAMEWORK_BUTTONS]
      : BASE_FRAMEWORK_BUTTONS;
  const [open, setOpen] = createSignal(false);
  const [tab, setTab] = createSignal<string | undefined>(tabs()[0]?.id);
  // Framework panels aren't tabs — they open over the tabs via the top strip.
  // With no site tabs, open Pages by default so the body isn't empty.
  const [overlay, setOverlay] = createSignal<FrameworkPanel | null>(
    tabs().length === 0 ? "pages" : null,
  );

  const openDrawer = () => setOpen(true);
  window.addEventListener(OPEN_SETTINGS_EVENT, openDrawer);
  onCleanup(() => window.removeEventListener(OPEN_SETTINGS_EVENT, openDrawer));

  const toggleOverlay = (o: FrameworkPanel) => setOverlay((cur) => (cur === o ? null : o));
  const selectTab = (id: string) => {
    setTab(id);
    setOverlay(null);
  };

  return (
    <div data-theme="louise">
      <Show when={open()}>
        <div class="louise-drawer-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
        <aside class="louise-drawer" role="dialog" aria-label="Louise explorer">
          <header class="louise-drawer-head">
            <span class="louise-who louise-drawer-brand">
              <span class="louise-who-dot" aria-hidden="true" />
              <span class="louise-who-name">{props.userName}</span>
            </span>
            <div class="louise-drawer-head-actions">
              <For each={frameworkButtons()}>
                {(b) => (
                  <button
                    class="louise-drawer-close louise-frame-btn"
                    classList={{ "is-active": overlay() === b.id }}
                    type="button"
                    aria-label={b.label}
                    aria-pressed={overlay() === b.id}
                    onClick={() => toggleOverlay(b.id)}
                  >
                    <Icon name={b.icon} />
                  </button>
                )}
              </For>
              <button
                class="louise-drawer-close"
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <Icon name="x" />
              </button>
            </div>
          </header>

          <Show when={tabs().length > 0}>
            <nav class="louise-drawer-tabs">
              <For each={tabs()}>
                {(t) => (
                  <button
                    class="louise-tab"
                    classList={{ "is-active": overlay() === null && tab() === t.id }}
                    type="button"
                    onClick={() => selectTab(t.id)}
                  >
                    {t.label}
                  </button>
                )}
              </For>
            </nav>
          </Show>

          <div class="louise-drawer-body">
            <Show when={overlay() === "users"}>
              <UsersPanel endpoint={props.usersEndpoint} />
            </Show>
            <Show when={overlay() === "media"}>
              <MediaPanel />
            </Show>
            <Show when={overlay() === "pages"}>
              <PagesPanel builtInPages={props.builtInPages} pageTemplates={props.pageTemplates} />
            </Show>
            <Show when={overlay() === "settings"}>
              <SettingsPanel
                baseGroups={props.settingsBaseGroups}
                extension={props.settingsExtension}
                extras={props.settingsExtras}
              />
            </Show>
            <Show when={overlay() === null}>
              <For each={tabs()} fallback={<p class="louise-muted">Pick a section above.</p>}>
                {(t) => <Show when={tab() === t.id}>{t.panel()}</Show>}
              </For>
            </Show>
          </div>
        </aside>
      </Show>
    </div>
  );
}

/**
 * Mount the Louise Settings shell: inject the Louise stylesheet, create the shared
 * QueryClient, and render into a body-appended root. Idempotent — a second call
 * is a no-op (Astro view-transition re-runs). Returns nothing; Louise Settings opens
 * on the {@link OPEN_SETTINGS_EVENT}.
 */
export function mountSettings(config: SettingsConfig): void {
  if (document.getElementById("louise-drawer-root")) return;
  injectStyles();
  const root = document.createElement("div");
  root.id = "louise-drawer-root";
  document.body.appendChild(root);
  const queryClient = createSettingsQueryClient();
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Settings {...config} />
      </QueryClientProvider>
    ),
    root,
  );
}
