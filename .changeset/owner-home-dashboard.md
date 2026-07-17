---
"louise-toolkit": minor
---

Add an owner **Home / Overview dashboard** as the Louise Settings drawer's default landing (#108) — an at-a-glance "what needs my attention?" surface instead of cold-opening into a CRUD panel.

- **Card registry** (`client/settings/dashboard/*`), mirroring the shell's tab pattern: `DashboardCard` (`id` / `order` / `render(api)`), a shared `<Card>` (title · status dot · plain-language body · one verb), and `HomePanel` — a traffic-light summary ("Your site is healthy" vs "3 things need your attention") over a responsive card grid. Each card is handed a card-scoped `DashboardApi` (`open` for cross-panel deep-links, `report` for reactive status). Exported from `louise-toolkit/client/settings`.
- **Built-in Phase-1 cards**, all reading one shared `/api/louise/overview` query (single round-trip): **Content** (drafts + unpublished → Review pages) and **Inbox** (unread → Open inbox) are live; **Health** (broken links / missing alt / SEO) is wired but stays absent until #106 persists the feed. Every card **degrades to hidden** when its slice is missing, so a brochure site's dashboard differs from a shop's with no config.
- **Server** `overviewRoute` (`core/editor/overview.ts`) — `GET /api/louise/overview` (editor-only), config-driven: the site supplies a resolver per slice (`content` / `inbox` / `health`) so the toolkit assumes no column names; an absent or throwing resolver is omitted rather than 500-ing the dashboard. Mount before `pagesRoute` like `searchRoute`.
- **Shell:** Home is a new fixed framework panel (leads the top strip) and the **default overlay when the drawer opens**. Owner-facing config: `dashboard?: { cards?, hide? }` to append site cards / hide built-ins, and `home?: false` to restore the old Pages-first landing. A `house` icon was added.

**Behavior change:** the drawer now opens to Home by default. Sites that haven't wired `overviewRoute` see an empty "Your site is healthy" landing (the cards degrade gracefully); pass `home={false}` to keep opening on Pages / the first tab. Wiring `overviewRoute` with content/inbox counts lights up the live cards.

The `HomePanel` registers no footer actions, so the drawer footer (#109) collapses on it — validating that panel's empty-slot case.
