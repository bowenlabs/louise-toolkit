// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The framework Users panel (top strip)—manage who can edit the content. Editors
// are the DB-managed admin allowlist (rows in the Better Auth user table):
// anyone listed here can sign in at /louise with a magic link and edit the live
// site. Talks to the site-wired `editorsRoute` (GET/POST/DELETE
// /api/louise/editors). This panel is scoped to content editors only—a site's
// own customers/staff accounts are application data, not managed here.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { apiErrorMessage, apiGet, apiSend, louiseQueryKey } from "./query.js";

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
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [error, setError] = createSignal("");

  const editorsQ = useQuery(() => ({
    queryKey: louiseQueryKey("editors"),
    queryFn: () => apiGet<{ editors: EditorRow[] }>(endpoint()).then((d) => d.editors),
  }));

  const invalidate = () => void qc.invalidateQueries({ queryKey: louiseQueryKey("editors") });

  const add = useMutation(() => ({
    mutationFn: () => apiSend("POST", endpoint(), { name: name().trim(), email: email().trim() }),
    onSuccess: () => {
      setName("");
      setEmail("");
      setError("");
      invalidate();
    },
    // The route's reason, such as an email that's already an editor.
    onError: (err) => setError(apiErrorMessage(err, "Couldn’t add that editor. Try again.")),
  }));

  const remove = useMutation(() => ({
    mutationFn: (id: string) => apiSend("DELETE", `${endpoint()}?id=${encodeURIComponent(id)}`),
    onSuccess: () => invalidate(),
    onError: (err) => setError(apiErrorMessage(err, "Couldn’t remove that editor.")),
  }));

  const editors = () => editorsQ.data ?? [];
  const label = (e: EditorRow) =>
    [e.firstName, e.lastName].filter(Boolean).join(" ") || e.name || e.email;
  // The button stays enabled and answers a missing email in words; a name is
  // optional, since the route falls back to the email.
  const invite = () => {
    if (!EMAIL_RE.test(email().trim())) {
      setError("Enter the editor’s email address.");
      return;
    }
    setError("");
    add.mutate();
  };

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
      <fieldset class="louise-field louise-fieldset">
        <legend class="louise-field-label">Invite an editor</legend>
        <label for="louise-invite-name">Name (optional)</label>
        <input
          id="louise-invite-name"
          class="louise-input"
          autocomplete="off"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <label for="louise-invite-email">Email</label>
        <input
          id="louise-invite-email"
          class="louise-input"
          type="email"
          autocomplete="off"
          placeholder="alex@example.com"
          aria-invalid={error() ? "true" : undefined}
          aria-describedby={error() ? "louise-invite-error" : undefined}
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
      </fieldset>

      <Show when={error()}>
        <p id="louise-invite-error" class="louise-field-error" role="alert">
          {error()}
        </p>
      </Show>

      <div class="louise-form-actions">
        <button
          class="louise-btn louise-btn-primary"
          type="button"
          disabled={add.isPending}
          onClick={invite}
        >
          {add.isPending ? "Adding…" : "Add editor"}
        </button>
      </div>
    </div>
  );
}
