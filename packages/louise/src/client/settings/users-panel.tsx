// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The framework Users panel (top strip) — manage who can edit the content. Editors
// are the DB-managed admin allowlist (rows in the Better Auth user table):
// anyone listed here can sign in at /louise with a magic link and edit the live
// site. Talks to the site-wired `editorsRoute` (GET/POST/DELETE
// /api/louise/editors). This panel is scoped to content editors only — a site's
// own customers/staff accounts are application data, not managed here.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { apiGet, apiSend, louiseQueryKey } from "./query.js";

/** An editor row as returned by `editorsRoute` GET. */
export interface EditorRow {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  name: string;
  email: string;
  role?: string | null;
}

export interface UsersPanelProps {
  /** Editors endpoint. Default `/api/louise/editors`. */
  endpoint?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UsersPanel(props: UsersPanelProps) {
  const endpoint = () => props.endpoint ?? "/api/louise/editors";
  const qc = useQueryClient();
  const [firstName, setFirstName] = createSignal("");
  const [lastName, setLastName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [error, setError] = createSignal("");

  const editorsQ = useQuery(() => ({
    queryKey: louiseQueryKey("editors"),
    queryFn: () => apiGet<{ editors: EditorRow[] }>(endpoint()).then((d) => d.editors),
  }));

  const invalidate = () => void qc.invalidateQueries({ queryKey: louiseQueryKey("editors") });

  const add = useMutation(() => ({
    mutationFn: () =>
      apiSend("POST", endpoint(), {
        firstName: firstName().trim(),
        lastName: lastName().trim(),
        email: email().trim(),
      }),
    onSuccess: () => {
      setFirstName("");
      setLastName("");
      setEmail("");
      setError("");
      invalidate();
    },
    // apiSend throws on non-2xx; surface a friendly message.
    onError: () => setError("Couldn't add that editor — check the email isn't already listed."),
  }));

  const remove = useMutation(() => ({
    mutationFn: (id: string) => apiSend("DELETE", `${endpoint()}?id=${encodeURIComponent(id)}`),
    onSuccess: () => invalidate(),
    onError: () => setError("Couldn't remove that editor."),
  }));

  const editors = () => editorsQ.data ?? [];
  const label = (e: EditorRow) =>
    [e.firstName, e.lastName].filter(Boolean).join(" ") || e.name || e.email;
  const canAdd = () => !!firstName().trim() && !!lastName().trim() && EMAIL_RE.test(email().trim());

  return (
    <div class="louise-form">
      <p class="louise-muted">
        People who can sign in at <code>/louise</code> with a magic link and edit the live site. Add
        or remove editors here.
      </p>
      <div style={{ height: "14px" }} />

      <Show when={!editorsQ.isLoading} fallback={<p class="louise-muted">Loading editors…</p>}>
        <div class="louise-list">
          <For each={editors()} fallback={<p class="louise-muted">No editors yet.</p>}>
            {(e) => (
              <div class="louise-list-item">
                <div class="louise-item-main">
                  <div class="louise-item-title">{label(e)}</div>
                  <div class="louise-item-sub louise-muted">{e.email}</div>
                </div>
                <button
                  class="louise-icon-btn"
                  type="button"
                  aria-label={`Remove ${label(e)}`}
                  disabled={editors().length <= 1 || remove.isPending}
                  onClick={() => remove.mutate(e.id)}
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div style={{ height: "18px" }} />
      <div class="louise-field">
        <span class="louise-field-label">Invite an editor</span>
        <div class="louise-row" style={{ gap: "8px" }}>
          <input
            class="louise-input"
            placeholder="First name"
            value={firstName()}
            onInput={(e) => setFirstName(e.currentTarget.value)}
          />
          <input
            class="louise-input"
            placeholder="Last name"
            value={lastName()}
            onInput={(e) => setLastName(e.currentTarget.value)}
          />
        </div>
        <input
          class="louise-input"
          type="email"
          placeholder="editor@email.com"
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
      </div>

      <Show when={error()}>
        <p class="louise-muted" style={{ color: "var(--louise-danger, #dc2626)" }}>
          {error()}
        </p>
      </Show>

      <div class="louise-form-actions">
        <button
          class="louise-btn louise-btn-primary"
          type="button"
          disabled={!canAdd() || add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending ? "Adding…" : "Add editor"}
        </button>
      </div>
    </div>
  );
}
