// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The built-in Phase-1 dashboard cards (#108). All three read ONE aggregate query
// (`/api/louise/overview`) so the dashboard is a single round-trip — TanStack
// dedupes the shared key. Each selects its slice, reports a status the summary
// header aggregates, and returns `absent` (rendering nothing) when its slice is
// missing, so a brochure site's dashboard differs from a shop's with no config.
//
// Owner-facing discipline: plain-language status + a single verb per card, never
// metrics. ContentStatus + Inbox are live today; Health lights up once #106
// persists the link-check feed and the overview route includes the `health` slice.

import { useQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { apiGet, louiseQueryKeys } from "../query.js";
import { Card } from "./Card.jsx";
import type { CardStatus, DashboardApi, DashboardCard, OverviewData } from "./types.js";

/** The one shared overview query every card reads (deduped by key). */
function useOverview() {
  return useQuery(() => ({
    queryKey: louiseQueryKeys.overview,
    queryFn: () => apiGet<OverviewData>("/api/louise/overview"),
  }));
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function ContentStatusCard(props: { api: DashboardApi }) {
  const q = useOverview();
  const slice = () => q.data?.content;
  const status = (): CardStatus => {
    if (q.isLoading) return { level: "loading" };
    const c = slice();
    if (!c) return { level: "absent" };
    const n = c.drafts + c.unpublished;
    return n > 0
      ? { level: "attention", count: n, label: `${plural(n, "page")} to publish` }
      : { level: "ok" };
  };
  props.api.report(status);

  const message = (c: NonNullable<OverviewData["content"]>) => {
    const parts: string[] = [];
    if (c.drafts) parts.push(`${c.drafts} ${plural(c.drafts, "draft")}`);
    if (c.unpublished) parts.push(`${c.unpublished} with unpublished changes`);
    return parts.length ? `${parts.join(" · ")} — ready to publish.` : "Everything is published.";
  };

  return (
    <Show when={slice()}>
      {(c) => (
        <Card
          title="Content"
          status={status()}
          action={{ label: "Review pages", onClick: () => props.api.open({ panel: "pages" }) }}
        >
          {message(c())}
        </Card>
      )}
    </Show>
  );
}

function InboxCard(props: { api: DashboardApi }) {
  const q = useOverview();
  const slice = () => q.data?.inbox;
  const status = (): CardStatus => {
    if (q.isLoading) return { level: "loading" };
    const i = slice();
    if (!i) return { level: "absent" };
    return i.unread > 0
      ? { level: "attention", count: i.unread, label: `new ${plural(i.unread, "message")}` }
      : { level: "ok" };
  };
  props.api.report(status);

  return (
    <Show when={slice()}>
      {(i) => (
        <Card
          title="Inbox"
          status={status()}
          action={{ label: "Open inbox", onClick: () => props.api.open({ tab: "inquiries" }) }}
        >
          {i().unread > 0
            ? `${i().unread} new ${plural(i().unread, "message")} waiting.`
            : "No new messages."}
        </Card>
      )}
    </Show>
  );
}

function HealthCard(props: { api: DashboardApi }) {
  const q = useOverview();
  const slice = () => q.data?.health;
  const status = (): CardStatus => {
    if (q.isLoading) return { level: "loading" };
    const h = slice();
    if (!h) return { level: "absent" };
    const n = h.brokenLinks + h.missingAlt + h.seoGaps;
    return n > 0
      ? { level: "attention", count: n, label: `${plural(n, "issue")} to fix` }
      : { level: "ok" };
  };
  props.api.report(status);

  const message = (h: NonNullable<OverviewData["health"]>) => {
    const parts: string[] = [];
    if (h.brokenLinks) parts.push(`${h.brokenLinks} broken ${plural(h.brokenLinks, "link")}`);
    if (h.missingAlt)
      parts.push(`${h.missingAlt} ${plural(h.missingAlt, "image")} missing a description`);
    if (h.seoGaps) parts.push(`${h.seoGaps} SEO ${plural(h.seoGaps, "gap")}`);
    return parts.length ? parts.join(" · ") : "No problems found.";
  };

  return (
    <Show when={slice()}>
      {(h) => (
        <Card
          title="Site health"
          status={status()}
          action={{ label: "Review", onClick: () => props.api.open({ panel: "pages" }) }}
        >
          {message(h())}
        </Card>
      )}
    </Show>
  );
}

/** The framework's built-in dashboard cards, in default order. A site can hide
 *  any by id (`dashboard.hide`) and append its own (`dashboard.cards`). */
export const BUILTIN_CARDS: DashboardCard[] = [
  { id: "content", order: 10, render: (api) => <ContentStatusCard api={api} /> },
  { id: "inbox", order: 20, render: (api) => <InboxCard api={api} /> },
  { id: "health", order: 30, render: (api) => <HealthCard api={api} /> },
];
