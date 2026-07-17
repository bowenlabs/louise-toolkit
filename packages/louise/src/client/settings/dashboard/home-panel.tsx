// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The owner Home/Overview landing (#108) — the drawer's default panel. It leads
// with attention, not fields: a traffic-light summary ("Your site is healthy" vs
// "3 things need your attention") over a grid of registerable cards. Each card is
// handed a card-scoped DashboardApi (cross-panel deep-links + status reporting);
// the panel aggregates every card's status into the summary.
//
// It registers NO footer actions — every card carries its own single verb — so
// the drawer footer (#109) collapses here, which is exactly the empty-slot case
// that panel validates.

import { createEffect, For } from "solid-js";
import { createStore } from "solid-js/store";
import type { CardStatus, DashboardApi, DashboardCard } from "./types.js";

/** Sum the counts of every card currently flagged `attention`. */
function attentionTotal(statuses: CardStatus[]): number {
  return statuses.reduce((n, s) => (s.level === "attention" ? n + s.count : n), 0);
}

function SummaryHeader(props: { statuses: CardStatus[] }) {
  const total = () => attentionTotal(props.statuses);
  const text = () =>
    total() === 0
      ? "Your site is healthy"
      : `${total()} ${total() === 1 ? "thing needs" : "things need"} your attention`;
  return (
    <div class="louise-dashboard-summary" data-state={total() === 0 ? "ok" : "attention"}>
      <span
        class="louise-card-dot"
        data-state={total() === 0 ? "ok" : "attention"}
        aria-hidden="true"
      />
      <span class="louise-dashboard-summary-text">{text()}</span>
    </div>
  );
}

export function HomePanel(props: { cards: DashboardCard[]; navigate: DashboardApi["open"] }) {
  // Card-scoped status registry. Cards report reactively; the summary aggregates.
  const [statuses, setStatuses] = createStore<Record<string, CardStatus>>({});
  const ordered = () => [...props.cards].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

  // Per-card API: shared navigation + a report that pipes the card's reactive
  // status into the registry (absent cards render nothing but still report, so
  // they simply don't contribute to the summary).
  const apiFor = (id: string): DashboardApi => ({
    open: props.navigate,
    report: (fn) => createEffect(() => setStatuses(id, fn())),
  });

  return (
    <div class="louise-dashboard">
      <SummaryHeader statuses={Object.values(statuses)} />
      <div class="louise-card-grid">
        <For each={ordered()}>{(c) => c.render(apiFor(c.id))}</For>
      </div>
    </div>
  );
}
