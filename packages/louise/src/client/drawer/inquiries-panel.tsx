// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// Default Inquiries panel — the package-provided body for the Inquiries
// collection tab. Contact-form submissions are created by the public site; the
// drawer only reviews and clears them, so this is read-mostly: list newest-first
// (GET /api/louise/inquiries), delete one by id. `inquiries` is a Louise base
// table, but how a site displays a submission varies, so this is a *tab* a site
// registers (in the bottom group) and can customize via `renderRow` — not a
// fixed framework panel like Pages/Media/Settings.

import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { For, type JSX, Show } from "solid-js";
import { Icon } from "../icons.jsx";
import { apiGet, apiSend, louiseQueryKeys } from "./query.js";

/** A submission row (site-defined columns; the defaults read common ones). */
export type InquiryRow = Record<string, unknown> & { id: number };

const str = (v: unknown) => (v == null ? "" : String(v));
/** First non-empty value among candidate keys — inquiry column names vary. */
const pick = (row: InquiryRow, keys: string[]) => {
  for (const k of keys) {
    const v = str(row[k]).trim();
    if (v) return v;
  }
  return "";
};

const fmtDate = (v: unknown) => {
  if (v == null || v === "") return "";
  // Accept unix seconds, unix millis, or an ISO/date string.
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

/** The built-in row renderer: name/email header, subject + timestamp, message
 *  body. Reads the framework `inquiriesColumns` (firstName/lastName/regarding)
 *  first, so a site on the stock schema needs no custom `renderRow`, then falls
 *  back to the common single-field variants other sites use. */
function DefaultRow(props: { row: InquiryRow }) {
  const name = () => {
    const full = [
      pick(props.row, ["firstName", "first_name"]),
      pick(props.row, ["lastName", "last_name"]),
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    return full || pick(props.row, ["name", "fullName", "full_name"]);
  };
  const email = () => pick(props.row, ["email", "emailAddress", "email_address"]);
  const regarding = () => pick(props.row, ["regarding", "subject"]);
  const message = () => pick(props.row, ["message", "body", "notes", "note"]);
  const when = () => fmtDate(props.row.createdAt ?? props.row.created_at ?? props.row.created);
  return (
    <div class="louise-item-main">
      <div class="louise-item-title">{name() || email() || `#${props.row.id}`}</div>
      <div class="louise-item-sub">
        {[email() && name() ? email() : "", regarding(), when()].filter(Boolean).join(" · ")}
      </div>
      <Show when={message()}>
        <p class="louise-inquiry-body">{message()}</p>
      </Show>
    </div>
  );
}

export interface InquiriesPanelProps {
  /** Mount path of the inquiries route. Default `/api/louise/inquiries`. */
  path?: string;
  /** Override the per-row body (columns/labels vary per site). */
  renderRow?: (row: InquiryRow) => JSX.Element;
}

export function InquiriesPanel(props: InquiriesPanelProps) {
  const qc = useQueryClient();
  const path = props.path ?? "/api/louise/inquiries";

  const query = useQuery(() => ({
    queryKey: louiseQueryKeys.inquiries,
    queryFn: () => apiGet<{ inquiries: InquiryRow[] }>(path).then((d) => d.inquiries),
  }));
  const list = () => query.data ?? [];

  const deleteMutation = useMutation(() => ({
    mutationFn: (id: number) => apiSend("DELETE", `${path}?id=${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: louiseQueryKeys.inquiries }),
    onError: (err) => console.error("[louise]", err),
  }));
  const del = (id: number) => {
    if (!confirm("Delete this inquiry? This can’t be undone.")) return;
    deleteMutation.mutate(id);
  };

  return (
    <Show when={!query.isLoading} fallback={<p class="louise-muted">Loading…</p>}>
      <Show when={list().length > 0} fallback={<p class="louise-muted">No inquiries yet.</p>}>
        <div class="louise-list">
          <For each={list()}>
            {(row) => (
              <div class="louise-list-item">
                {props.renderRow ? props.renderRow(row) : <DefaultRow row={row} />}
                <button
                  class="louise-icon-btn"
                  type="button"
                  aria-label="Delete"
                  disabled={deleteMutation.isPending}
                  onClick={() => del(row.id)}
                >
                  <Icon name="trash" />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}
