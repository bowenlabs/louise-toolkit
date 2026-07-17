// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework Settings panel — edits the structured `site_settings` singleton
// (identity, appearance, navigation, contact, SEO) that every Louise site
// shares, and exposes an extension slot for site-specific settings. Talks to
// the generic louise-toolkit/editor `settings` route (GET current, POST patch)
// through TanStack Query. Opened from the gear icon in the Settings' top strip.
//
// The panel is fixed and framework-owned, but its contents = a common base
// (mapping 1:1 to `siteSettingsColumns`) PLUS a site's declarative extension
// groups. Base keys patch their structured columns; extension keys (site-
// declared) merge into the `custom` JSON — the server allowlist is authoritative,
// so a key the site didn't declare is ignored, never written.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../icons.jsx";
import {
  Section,
  SettingsField,
  type SettingsFieldDef,
  type SettingsFieldGroup,
} from "./fields.jsx";
import { type SaveStatus, usePanelActions } from "./panel-actions.jsx";
import { apiGet, apiSend, louiseQueryKeys } from "./query.js";

/**
 * The framework-common settings groups — mapped 1:1 to the owner-facing
 * `siteSettingsColumns`. Rendered by default; a site that only uses some of them
 * (or wants them reordered) passes its own selection as `baseGroups`, so no
 * empty framework fields show. Exported so a site can cherry-pick from them.
 */
export const SETTINGS_BASE_GROUPS: SettingsFieldGroup[] = [
  {
    title: "Identity",
    hint: "Your site's name and marks.",
    open: true,
    fields: [
      { key: "siteName", label: "Site name" },
      { key: "tagline", label: "Tagline" },
      { key: "logoUrl", label: "Logo", type: "image" },
      { key: "faviconUrl", label: "Favicon", type: "image" },
    ],
  },
  {
    title: "Appearance",
    hint: "Brand colors and light/dark preference.",
    fields: [
      { key: "brandColor", label: "Brand color", type: "color" },
      { key: "secondaryColor", label: "Secondary color", type: "color" },
      { key: "tertiaryColor", label: "Tertiary color", type: "color" },
      { key: "darkMode", label: "Dark mode", type: "toggle" },
    ],
  },
  {
    title: "Navigation",
    hint: "Links in the header and footer. Order here is the order shown.",
    fields: [{ key: "navLinks", label: "Navigation links", type: "links" }],
  },
  {
    title: "Contact",
    hint: "How visitors reach you, and your social links.",
    fields: [
      { key: "contactEmail", label: "Contact email" },
      { key: "contactPhone", label: "Contact phone" },
      { key: "contactAddress", label: "Contact address", type: "textarea" },
      { key: "socialLinks", label: "Social links", type: "links" },
    ],
  },
  {
    title: "SEO",
    hint: "Site-wide defaults; individual pages can override them.",
    fields: [
      { key: "metaDescription", label: "Meta description", type: "textarea" },
      { key: "defaultOgImageUrl", label: "Default share image", type: "image" },
      { key: "disableIndexing", label: "Hide from search engines", type: "toggle" },
    ],
  },
];

/** Seed a store value from the loaded settings, defaulting by field type so
 *  every rendered field is controlled from first paint. */
function coerce(value: unknown, type: SettingsFieldDef["type"]): unknown {
  if (type === "toggle") return Boolean(value);
  if (type === "links") return Array.isArray(value) ? value : [];
  return value ?? "";
}

/** Ends the session and drops edit mode. */
async function signOut() {
  try {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } catch {
    /* best-effort — still drop edit mode below */
  }
  const url = new URL(location.href);
  url.searchParams.set("louise", "off");
  location.assign(`${url.pathname}${url.search}`);
}

export interface SettingsPanelProps {
  /** Override the framework base groups shown at the top. Omit for all of
   *  {@link SETTINGS_BASE_GROUPS}; pass a subset (or reordered/edited copy) so a
   *  site only surfaces the framework fields it actually uses. */
  baseGroups?: SettingsFieldGroup[];
  /** Site-specific settings groups (declarative field defs), rendered below the
   *  base groups and persisted to `custom` via the site's declared keys. */
  extension?: SettingsFieldGroup[];
  /** Escape hatch for bespoke sections that manage their own persistence
   *  (e.g. a passkey enrollment section) — rendered after the save action. */
  extras?: () => JSX.Element;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const qc = useQueryClient();
  const actions = usePanelActions();
  const [values, setValues] = createSignal<Record<string, unknown>>({});
  // The last-loaded (or last-saved) snapshot — the target Revert restores to,
  // and the baseline the dirty flag is measured against.
  const [loaded, setLoaded] = createSignal<Record<string, unknown>>({});
  const [dirty, setDirty] = createSignal(false);
  const [status, setStatus] = createSignal<"idle" | "saving" | "saved" | "error">("idle");

  const groups = () => [...(props.baseGroups ?? SETTINGS_BASE_GROUPS), ...(props.extension ?? [])];
  const allFields = () => groups().flatMap((g) => g.fields);

  const setField = (key: string, value: unknown) => {
    setValues({ ...values(), [key]: value });
    setDirty(true);
    setStatus("idle");
  };

  const query = useQuery(() => ({
    queryKey: louiseQueryKeys.settings,
    queryFn: async () => {
      const data = await apiGet<{ settings: Record<string, unknown> }>("/api/louise/settings");
      const settings = data.settings ?? {};
      const seeded: Record<string, unknown> = {};
      // Custom-render fields get the raw stored value (they own their own shape,
      // e.g. an array of rows); typed fields are coerced to a controlled default.
      for (const def of allFields()) {
        seeded[def.key] = def.render ? settings[def.key] : coerce(settings[def.key], def.type);
      }
      setValues(seeded);
      setLoaded({ ...seeded });
      setDirty(false);
      return settings;
    },
  }));

  const saveMutation = useMutation(() => ({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      for (const def of allFields()) patch[def.key] = values()[def.key];
      return apiSend("POST", "/api/louise/settings", patch);
    },
    onSuccess: async () => {
      setStatus("saved");
      setLoaded({ ...values() });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: louiseQueryKeys.settings });
    },
    onError: (err) => {
      console.error("[louise]", err);
      setStatus("error");
    },
  }));
  const save = async () => {
    setStatus("saving");
    // mutateAsync rejects on error; onError already flips status → swallow so the
    // footer button's busy state just settles (the status pill shows the error).
    await saveMutation.mutateAsync().catch(() => {});
  };
  const revert = () => {
    setValues({ ...loaded() });
    setDirty(false);
    setStatus("idle");
  };

  // The footer owns Save/Revert (the single, always-visible home for them). The
  // primary busyLabel shows "Saving…"; the status pill carries the terminal
  // saved/error feedback (idle while saving so it isn't shown twice).
  onMount(() =>
    onCleanup(
      actions.push(
        [
          {
            id: "save",
            label: "Save",
            kind: "primary",
            busyLabel: "Saving…",
            disabled: () => !dirty(),
            onClick: save,
          },
          {
            id: "revert",
            label: "Revert",
            kind: "ghost",
            disabled: () => !dirty(),
            onClick: revert,
          },
        ],
        (): SaveStatus =>
          status() === "saved"
            ? { state: "saved" }
            : status() === "error"
              ? { state: "error", message: "Couldn’t save" }
              : { state: "idle" },
      ),
    ),
  );

  return (
    <Show when={!query.isLoading} fallback={<p class="louise-muted">Loading…</p>}>
      <For each={groups()}>
        {(group) => (
          <Section title={group.title} hint={group.hint} open={group.open}>
            <For each={group.fields}>
              {(def) => (
                <SettingsField
                  def={def}
                  value={values()[def.key]}
                  onChange={(v) => setField(def.key, v)}
                />
              )}
            </For>
          </Section>
        )}
      </For>

      <Show when={props.extras}>{props.extras?.()}</Show>

      <Section title="Session" hint="Sign out of Louise and return to the public site.">
        <button class="louise-btn louise-btn-danger" type="button" onClick={() => void signOut()}>
          <Icon name="signOut" /> Sign out
        </button>
      </Section>
    </Show>
  );
}
