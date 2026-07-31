// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The parts of the Louise editor surface that are the same whether it renders as
// a drawer over the live page or as a full-page admin app.
//
// Extracted rather than copied. Which panels exist, which framework buttons show,
// how a dashboard card deep-links to one — all of that is the surface's real
// content, and a second presentation that reimplemented it would drift the moment
// either gained a panel. The presentations differ only in CHROME: the drawer adds
// a scrim, a dialog role, a focus trap and a close button; the page adds none of
// those and is simply always open.

import { For, Show } from "solid-js";
import { Icon, type IconName } from "../icons.jsx";
import { BUILTIN_CARDS } from "./dashboard/cards.jsx";
import { HealthPanel } from "./dashboard/health-panel.jsx";
import { HomePanel } from "./dashboard/home-panel.jsx";
import type { DashboardApi, DashboardCard } from "./dashboard/types.js";
import type { SettingsFieldGroup } from "./fields.jsx";
import { MediaPanel } from "./media-panel.jsx";
import { type BuiltInPageRef, type PageTemplate, PagesPanel } from "./pages-panel.jsx";
import { SettingsPanel } from "./settings-panel.jsx";
import { UsersPanel } from "./users-panel.jsx";
import type { OgCardOptions } from "../../core/browser/og-card.js";
import type { JSX } from "solid-js";

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

/** The framework panels, keyed by their top-strip icon. Home/Media/Pages/Settings
 *  are always present; `users` is opt-in (config.users + a wired editorsRoute).
 *  `health` is a hidden drill-in (reached from the Home Health card, not a
 *  top-strip button). */
export type FrameworkPanel = "home" | "users" | "media" | "pages" | "settings" | "health";

/** The framework buttons every presentation shows, in strip order. Home and
 *  Users are conditional and prepended by {@link frameworkButtons}. */
const BASE_FRAMEWORK_BUTTONS: { id: FrameworkPanel; label: string; icon: IconName }[] = [
  { id: "media", label: "Media", icon: "image" },
  { id: "pages", label: "Pages", icon: "fileText" },
  { id: "settings", label: "Settings", icon: "gear" },
];

/** Everything both presentations need to render the same panels. */
export interface SurfaceConfig {
  tabs?: CollectionTab[];
  builtInPages?: BuiltInPageRef[];
  pageTemplates?: PageTemplate[];
  ogCard?: OgCardOptions;
  settingsBaseGroups?: SettingsFieldGroup[];
  settingsExtension?: SettingsFieldGroup[];
  settingsExtras?: () => JSX.Element;
  users?: boolean;
  usersEndpoint?: string;
  home?: boolean;
  dashboard?: {
    cards?: DashboardCard[];
    hide?: string[];
    healthEndpoint?: string;
  };
}

/** The top strip, in order: Home (unless disabled), Users (opt-in), then the
 *  fixed three. */
export function frameworkButtons(
  config: SurfaceConfig,
): { id: FrameworkPanel; label: string; icon: IconName }[] {
  return [
    ...(config.home !== false
      ? [{ id: "home" as const, label: "Home", icon: "house" as const }]
      : []),
    ...(config.users ? [{ id: "users" as const, label: "Users", icon: "user" as const }] : []),
    ...BASE_FRAMEWORK_BUTTONS,
  ];
}

/** The built-in cards a site didn't hide, plus its own. */
export function surfaceCards(config: SurfaceConfig): DashboardCard[] {
  return [
    ...BUILTIN_CARDS.filter((c) => !(config.dashboard?.hide ?? []).includes(c.id)),
    ...(config.dashboard?.cards ?? []),
  ];
}

/** Which panel a presentation should land on when it first opens: Home, or —
 *  with Home disabled — Pages when there are no tabs, else the first tab. */
export function initialPanel(config: SurfaceConfig): FrameworkPanel | null {
  if (config.home !== false) return "home";
  return (config.tabs ?? []).length === 0 ? "pages" : null;
}

/** The framework button row. Presentation-agnostic: the drawer renders its close
 *  and history buttons alongside, the page renders it alone. */
export function FrameworkNav(props: {
  config: SurfaceConfig;
  active: FrameworkPanel | null;
  onToggle: (panel: FrameworkPanel) => void;
}): JSX.Element {
  return (
    <For each={frameworkButtons(props.config)}>
      {(b) => (
        <button
          class="louise-drawer-close louise-frame-btn"
          classList={{ "is-active": props.active === b.id }}
          type="button"
          aria-label={b.label}
          aria-pressed={props.active === b.id}
          onClick={() => props.onToggle(b.id)}
        >
          <Icon name={b.icon} />
        </button>
      )}
    </For>
  );
}

/** The collection-tab row. Renders nothing when a site registered no tabs. */
export function SurfaceTabs(props: {
  tabs: CollectionTab[];
  active: string | undefined;
  overlayOpen: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <Show when={props.tabs.length > 0}>
      <nav class="louise-drawer-tabs">
        <For each={props.tabs}>
          {(t) => (
            <button
              class="louise-tab"
              classList={{ "is-active": !props.overlayOpen && props.active === t.id }}
              type="button"
              onClick={() => props.onSelect(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </nav>
    </Show>
  );
}

/**
 * The panel body — the substantial half, and the reason this module exists.
 *
 * Every panel a Louise editor has, switched on the active overlay, with the
 * registered tabs underneath. A presentation supplies the surrounding chrome and
 * nothing else.
 */
export function SurfacePanels(props: {
  config: SurfaceConfig;
  overlay: FrameworkPanel | null;
  tab: string | undefined;
  navigate: DashboardApi["open"];
}): JSX.Element {
  const tabs = () => props.config.tabs ?? [];
  return (
    <>
      <Show when={props.overlay === "home"}>
        <HomePanel cards={surfaceCards(props.config)} navigate={props.navigate} />
      </Show>
      <Show when={props.overlay === "health"}>
        <HealthPanel navigate={props.navigate} endpoint={props.config.dashboard?.healthEndpoint} />
      </Show>
      <Show when={props.overlay === "users"}>
        <UsersPanel endpoint={props.config.usersEndpoint} />
      </Show>
      <Show when={props.overlay === "media"}>
        <MediaPanel />
      </Show>
      <Show when={props.overlay === "pages"}>
        <PagesPanel
          builtInPages={props.config.builtInPages}
          pageTemplates={props.config.pageTemplates}
          ogCard={props.config.ogCard}
        />
      </Show>
      <Show when={props.overlay === "settings"}>
        <SettingsPanel
          baseGroups={props.config.settingsBaseGroups}
          extension={props.config.settingsExtension}
          extras={props.config.settingsExtras}
        />
      </Show>
      <Show when={props.overlay === null}>
        <For each={tabs()} fallback={<p class="louise-muted">Pick a section above.</p>}>
          {(t) => <Show when={props.tab === t.id}>{t.panel()}</Show>}
        </For>
      </Show>
    </>
  );
}
