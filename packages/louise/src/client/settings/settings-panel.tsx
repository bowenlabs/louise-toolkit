// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Framework Settings panel—edits the structured `site_settings` singleton
// (identity, appearance, navigation, contact, SEO) that every Louise site
// shares, and exposes an extension slot for site-specific settings. Talks to
// the generic louise-toolkit/editor `settings` route (GET current, POST patch)
// through TanStack Query. Opened from the gear icon in the Settings' top strip.
//
// The panel is fixed and framework-owned, but its contents = a common base
// (mapping 1:1 to `siteSettingsColumns`) PLUS a site's declarative extension
// groups. Base keys patch their structured columns; extension keys (site-
// declared) merge into the `custom` JSON—the server allowlist is authoritative,
// so a key the site didn't declare is ignored, never written.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import {
  normalizeLinkHref,
  Section,
  SettingsField,
  type SettingsFieldDef,
  type SettingsFieldGroup,
} from "./fields.jsx";
import { type SaveStatus, usePanelActions } from "./panel-actions.jsx";
import {
  type ApiViolation,
  apiErrorMessage,
  apiGet,
  apiSend,
  LouiseApiError,
  louiseQueryKeys,
} from "./query.js";

/** The server's violations, by field: a message for the field itself, and one
 *  per row for a list such as `navLinks[1].href`. */
interface FieldErrors {
  field: Record<string, string>;
  rows: Record<string, Record<number, string>>;
}

const NO_ERRORS: FieldErrors = { field: {}, rows: {} };

/** Map each violation's `path` onto the field, and the row, it names. */
export function fieldErrorsFrom(violations: readonly ApiViolation[]): FieldErrors {
  const out: FieldErrors = { field: {}, rows: {} };
  for (const v of violations) {
    const match = /^([^.[\]]+)(?:\[(\d+)\])?/.exec(v.path);
    if (!match) continue;
    const [, key, row] = match;
    if (row === undefined) out.field[key!] ??= v.message;
    else (out.rows[key!] ??= {})[Number(row)] ??= v.message;
  }
  return out;
}

/** Add `https://` to each scheme-less link in a `links` value. */
function normalizeLinks(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) =>
    row && typeof row === "object" && typeof (row as { href?: unknown }).href === "string"
      ? { ...row, href: normalizeLinkHref((row as { href: string }).href) }
      : row,
  );
}

/**
 * The framework-common settings groups—mapped 1:1 to the owner-facing
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

export interface SettingsPanelProps {
  /** Override the framework base groups shown at the top. Omit for all of
   *  {@link SETTINGS_BASE_GROUPS}; pass a subset (or reordered/edited copy) so a
   *  site only surfaces the framework fields it actually uses. */
  baseGroups?: SettingsFieldGroup[];
  /** Site-specific settings groups (declarative field defs), rendered below the
   *  base groups and persisted to `custom` via the site's declared keys. */
  extension?: SettingsFieldGroup[];
  /** Escape hatch for bespoke sections that manage their own persistence
   *  (for example, a passkey enrollment section), rendered after the save action. */
  extras?: () => JSX.Element;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const qc = useQueryClient();
  const actions = usePanelActions();
  const [values, setValues] = createSignal<Record<string, unknown>>({});
  // The last-loaded (or last-saved) snapshot—the target Revert restores to,
  // and the baseline the dirty flag is measured against.
  const [loaded, setLoaded] = createSignal<Record<string, unknown>>({});
  const [dirty, setDirty] = createSignal(false);
  const [status, setStatus] = createSignal<SaveStatus>({ state: "idle" });
  const [errors, setErrors] = createSignal<FieldErrors>(NO_ERRORS);
  let root: HTMLDivElement | undefined;

  const groups = () => [...(props.baseGroups ?? SETTINGS_BASE_GROUPS), ...(props.extension ?? [])];
  const allFields = () => groups().flatMap((g) => g.fields);

  const setField = (key: string, value: unknown) => {
    setValues({ ...values(), [key]: value });
    setDirty(true);
    setStatus({ state: "idle" });
    // An edit answers that field's message; the others stay until the next save.
    const { field, rows } = errors();
    if (key in field || key in rows) {
      const { [key]: _field, ...restField } = field;
      const { [key]: _rows, ...restRows } = rows;
      setErrors({ field: restField, rows: restRows });
    }
  };

  // Show the first field the server refused: open its section, then focus it.
  const revealFirstError = () =>
    queueMicrotask(() => {
      const first = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
      const section = first?.closest("details");
      if (section) section.open = true;
      first?.focus();
    });

  const query = useQuery(() => ({
    queryKey: louiseQueryKeys.settings,
    queryFn: async () => {
      const data = await apiGet<{ settings: Record<string, unknown> }>("/api/louise/settings");
      const settings = data.settings ?? {};
      const seeded: Record<string, unknown> = {};
      // Custom-render fields get the raw stored value (they own their own shape,
      // for example, an array of rows); typed fields are coerced to a controlled default.
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
      // Links typed as `example.com/shop` get their scheme before they're sent,
      // and the form shows the corrected value.
      const fixed = { ...values() };
      for (const def of allFields()) {
        if (def.type === "links") fixed[def.key] = normalizeLinks(fixed[def.key]);
      }
      setValues(fixed);
      const patch: Record<string, unknown> = {};
      for (const def of allFields()) patch[def.key] = fixed[def.key];
      return apiSend("POST", "/api/louise/settings", patch);
    },
    onSuccess: async () => {
      setStatus({ state: "saved" });
      setErrors(NO_ERRORS);
      setLoaded({ ...values() });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: louiseQueryKeys.settings });
    },
    onError: (err) => {
      console.error("[louise]", err);
      const violations = err instanceof LouiseApiError ? (err.body.violations ?? []) : [];
      setErrors(fieldErrorsFrom(violations));
      setStatus({ state: "error", message: apiErrorMessage(err, "Couldn’t save") });
      if (violations.length > 0) revealFirstError();
    },
  }));
  // Save and Revert stay enabled, so they stay in the tab order and Cmd+S
  // always answers. With nothing changed, the status pill says so.
  const save = async () => {
    if (!dirty()) {
      setStatus({ state: "notice", message: "No changes to save" });
      return;
    }
    setStatus({ state: "saving" });
    // mutateAsync rejects on error; onError already flips status → swallow so the
    // footer button's busy state just settles (the status pill shows the error).
    await saveMutation.mutateAsync().catch(() => {});
  };
  const revert = () => {
    if (!dirty()) {
      setStatus({ state: "notice", message: "No changes to revert" });
      return;
    }
    setValues({ ...loaded() });
    setErrors(NO_ERRORS);
    setDirty(false);
    setStatus({ state: "idle" });
  };

  // The footer owns Save/Revert (the single, always-visible home for them). The
  // primary busyLabel shows "Saving…"; the status pill carries the terminal
  // saved/error feedback (idle while saving so it isn't shown twice).
  onMount(() =>
    onCleanup(
      actions.push(
        [
          { id: "save", label: "Save", kind: "primary", busyLabel: "Saving…", onClick: save },
          { id: "revert", label: "Revert", kind: "ghost", onClick: revert },
        ],
        // "saving" shows as the button's busy label, so the pill stays quiet.
        (): SaveStatus => (status().state === "saving" ? { state: "idle" } : status()),
      ),
    ),
  );

  return (
    <Show when={!query.isLoading} fallback={<p class="louise-muted">Loading…</p>}>
      <div ref={root}>
        <For each={groups()}>
          {(group) => (
            <Section title={group.title} hint={group.hint} open={group.open}>
              <For each={group.fields}>
                {(def) => (
                  <SettingsField
                    def={def}
                    value={values()[def.key]}
                    onChange={(v) => setField(def.key, v)}
                    error={errors().field[def.key]}
                    rowErrors={errors().rows[def.key]}
                  />
                )}
              </For>
            </Section>
          )}
        </For>
      </div>

      {/* The "Session" group's Sign out moved to the edit bar:
          ending a session is an account action, not a site setting, and having it
          in two places meant the obvious control ("Done") was the one that didn't
          actually sign you out. */}
      <Show when={props.extras}>{props.extras?.()}</Show>
    </Show>
  );
}
