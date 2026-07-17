// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The owner Home/Overview dashboard (#108) — a registry of composable cards,
// mirroring the shell's CollectionTab pattern. Each card reads one slice of the
// shared overview query, reports a status the summary header aggregates into a
// traffic light, and degrades to "absent" (hides itself) when its data source
// isn't wired. Built-in cards and site-registered cards use the exact same shape.

import type { JSX } from "solid-js";

/** A framework panel (top strip) a card can deep-link into. */
export type DashboardPanelTarget = "home" | "pages" | "media" | "settings" | "users";

/** What a card reports up so the summary header can aggregate a traffic light. */
export type CardStatus =
  | { level: "ok" } // green — nothing needs attention
  | { level: "attention"; count: number; label: string } // e.g. { 3, "drafts to publish" }
  | { level: "loading" } // still resolving
  | { level: "absent" }; // data source/binding missing → card + status hidden

/** Handed to every card: cross-panel deep-links + status reporting (card-scoped). */
export interface DashboardApi {
  /** Deep-link into another surface — a framework panel or a site tab. */
  open(target: { panel: DashboardPanelTarget } | { tab: string }): void;
  /** Report this card's status reactively; the header aggregates all of them. */
  report(status: () => CardStatus): void;
}

export interface DashboardCard {
  /** Stable id — de-dup key, query-key segment, and `hide` target. */
  id: string;
  /** Lower renders earlier. Built-ins use 10/20/30; site cards default to 100. */
  order?: number;
  /** Card body — typically the shared `<Card>`. Return `null` to self-suppress. */
  render: (api: DashboardApi) => JSX.Element;
}

/** The `/api/louise/overview` payload — every slice optional so a card degrades
 *  to "absent" (rather than erroring) when its data source isn't wired. */
export interface OverviewData {
  content?: { drafts: number; unpublished: number; lastEditedAt?: string };
  inbox?: { unread: number };
  health?: { brokenLinks: number; missingAlt: number; seoGaps: number; checkedAt?: string };
}
