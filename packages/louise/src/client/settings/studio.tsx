// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/client/studio` — the Louise editor as a full-page admin app.
//
// The drawer shell is drawer-shaped: summoned over a live page, dismissed, gone.
// That is right for editing in place and wrong for the back-office half of the
// job — a laptop session spent in Media and Pages, deep-linked and bookmarked.
// A site wanting that had to rebuild the shell even though every panel already
// existed.
//
// So this is a second PRESENTATION, not a second implementation. Both render the
// same panels through `./surface`; the drawer adds a scrim, a dialog role, a
// focus trap and a close button, and this adds none of them because it is simply
// always open.
//
// ── The design constraint worth keeping ──────────────────────────────────────
//
// This shell renders NO DATA and NO SESSION-SPECIFIC MARKUP. Every panel fetches
// through `/api/*` on mount, so the HTML is identical for every editor and for a
// signed-out visitor — which is what makes it precacheable by a service worker
// (see `PwaConfig.offlineFallback`). Bake a name or a row count into the shell
// and it stops being cacheable, or worse, gets cached and served to the next
// person.
//
// The corollary is that authorization is an API concern here, not a render one:
// a 401 from any panel query means the session is gone, and the studio sends the
// browser to `signInPath` rather than rendering an empty app.

import { QueryClientProvider } from "@tanstack/solid-query";
import { createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { injectStyles } from "../styles.js";
import type { DashboardApi } from "./dashboard/types.js";
import { DrawerFooter, PanelActionsProvider } from "./panel-actions.jsx";
import { createSettingsQueryClient, isApiStatus } from "./query.js";
import {
  type FrameworkPanel,
  FrameworkNav,
  initialPanel,
  type SurfaceConfig,
  SurfacePanels,
  SurfaceTabs,
} from "./surface.jsx";

/** Default landing path when a query says the session is gone. */
const DEFAULT_SIGN_IN_PATH = "/signin";

export interface StudioConfig extends SurfaceConfig {
  /**
   * Header title. **Static config, never session data** — a site name, not an
   * editor name. Anything per-editor here would defeat the cacheability this
   * shell is built for. Default `"Studio"`.
   */
  title?: string;
  /**
   * Where to send the browser when a panel query answers 401. Default
   * `"/signin"`.
   *
   * A full-page app cannot degrade to "render the public page" the way the
   * drawer can — there is no page underneath it — so an expired session has to
   * become a navigation rather than an empty shell with failing panels.
   */
  signInPath?: string;
}

/**
 * The full-page studio. Mount it inside a `client:only` island; see
 * `reference/client.md` for the routed variant.
 */
export function Studio(props: StudioConfig): ReturnType<typeof PanelActionsProvider> {
  const tabs = () => props.tabs ?? [];
  const [tab, setTab] = createSignal<string | undefined>(tabs()[0]?.id);
  const [overlay, setOverlay] = createSignal<FrameworkPanel | null>(initialPanel(props));

  const toggleOverlay = (panel: FrameworkPanel) =>
    setOverlay((cur) => (cur === panel ? null : panel));
  const selectTab = (id: string) => {
    setTab(id);
    setOverlay(null);
  };
  const navigate: DashboardApi["open"] = (target) =>
    "panel" in target ? setOverlay(target.panel) : selectTab(target.tab);

  return (
    <div class="louise-studio" data-theme="louise">
      <header class="louise-drawer-head louise-studio-head">
        <span class="louise-who louise-drawer-brand">
          <span class="louise-who-dot" aria-hidden="true" />
          <span class="louise-who-name">{props.title ?? "Studio"}</span>
        </span>
        <div class="louise-drawer-head-actions">
          <FrameworkNav config={props} active={overlay()} onToggle={toggleOverlay} />
        </div>
      </header>

      <SurfaceTabs
        tabs={tabs()}
        active={tab()}
        overlayOpen={overlay() !== null}
        onSelect={selectTab}
      />

      <PanelActionsProvider>
        <div class="louise-drawer-body louise-studio-body">
          <SurfacePanels config={props} overlay={overlay()} tab={tab()} navigate={navigate} />
        </div>
        <DrawerFooter />
      </PanelActionsProvider>
    </div>
  );
}

/** Resolve a mount target: an element, a selector, or a body-appended root. */
function resolveTarget(target: StudioMountOptions["target"]): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (typeof target === "string") return document.querySelector<HTMLElement>(target);
  const root = document.createElement("div");
  root.id = "louise-studio-root";
  document.body.appendChild(root);
  return root;
}

export interface StudioMountOptions extends StudioConfig {
  /** Element or selector to render into. Omit for a body-appended root. */
  target?: HTMLElement | string;
}

/**
 * Mount the full-page studio.
 *
 * Idempotent per target, like `mountSettings` — a client-side route change or an
 * Astro view transition can re-run this without stacking two apps. Returns a
 * disposer for the cases that need one (a router unmounting the island).
 */
export function mountStudio(config: StudioMountOptions = {}): () => void {
  const existing = document.getElementById("louise-studio-root");
  if (existing && !config.target) return () => {};

  injectStyles();
  const host = resolveTarget(config.target);
  if (!host) {
    // A selector that matched nothing is a wiring mistake, and silently
    // rendering nothing is the least useful way to report it.
    throw new Error(
      `mountStudio: no element matched ${JSON.stringify(config.target)}. ` +
        "Pass an element, a selector that exists at mount time, or omit `target`.",
    );
  }

  const queryClient = createSettingsQueryClient();
  // A 401 anywhere means the session is gone. Handled centrally rather than per
  // panel: every panel would otherwise need the same branch, and the one that
  // forgot would render an empty list that looks like "no data" instead of
  // "signed out".
  const signInPath = config.signInPath ?? DEFAULT_SIGN_IN_PATH;
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    if (isApiStatus(event.query.state.error, 401)) {
      window.location.assign(signInPath);
    }
  });

  const dispose = render(() => {
    onMount(() => document.documentElement.setAttribute("data-louise-studio", ""));
    onCleanup(() => document.documentElement.removeAttribute("data-louise-studio"));
    return (
      <QueryClientProvider client={queryClient}>
        <Studio {...config} />
      </QueryClientProvider>
    );
  }, host);

  return () => {
    dispose();
    if (!config.target) host.remove();
  };
}
