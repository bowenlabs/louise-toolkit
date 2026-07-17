// #108 owner Home dashboard — happy-dom Solid tests for the card registry:
// cards read one shared overview query, report statuses the summary aggregates
// into a traffic light, degrade to "absent" (hidden) when their slice is missing,
// and deep-link via `navigate`. Also asserts the empty dashboard registers no
// footer actions (the #109 empty-slot case).

import { QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_CARDS,
  createSettingsQueryClient,
  type DashboardApi,
  DrawerFooter,
  HomePanel,
  PanelActionsProvider,
} from "../../src/client/settings/index.js";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mount(ui: () => JSX.Element) {
  const qc = createSettingsQueryClient();
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <QueryClientProvider client={qc}>{ui()}</QueryClientProvider>, host);
}

function stubOverview(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});

const summaryText = () =>
  host.querySelector<HTMLElement>(".louise-dashboard-summary-text")?.textContent ?? "";
const cardTitles = () =>
  Array.from(host.querySelectorAll<HTMLElement>(".louise-card-title")).map((h) =>
    h.textContent?.trim(),
  );
const cardActionByLabel = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(".louise-card-action")).find(
    (b) => b.textContent?.trim() === label,
  );

describe("HomePanel — built-in cards + summary", () => {
  it("renders content + inbox cards and aggregates the attention summary", async () => {
    stubOverview({ content: { drafts: 2, unpublished: 1 }, inbox: { unread: 3 } });
    mount(() => <HomePanel cards={BUILTIN_CARDS} navigate={() => {}} />);

    await vi.waitFor(() => expect(cardTitles()).toContain("Content"));
    expect(cardTitles()).toContain("Inbox");
    // Health has no slice → absent → not rendered.
    expect(cardTitles()).not.toContain("Site health");

    expect(host.textContent).toContain("2 drafts · 1 with unpublished changes");
    expect(host.textContent).toContain("3 new messages waiting.");
    // Summary sums every attention card's count (content 3 + inbox 3).
    await vi.waitFor(() => expect(summaryText()).toBe("6 things need your attention"));
  });

  it("shows the healthy summary and no cards when every slice is absent", async () => {
    stubOverview({});
    mount(() => <HomePanel cards={BUILTIN_CARDS} navigate={() => {}} />);

    await vi.waitFor(() => expect(host.querySelector(".louise-dashboard")).not.toBeNull());
    expect(summaryText()).toBe("Your site is healthy");
    expect(cardTitles()).toEqual([]);
  });

  it("renders an all-clear card (ok) without inflating the summary", async () => {
    stubOverview({ inbox: { unread: 0 } });
    mount(() => <HomePanel cards={BUILTIN_CARDS} navigate={() => {}} />);

    await vi.waitFor(() => expect(cardTitles()).toContain("Inbox"));
    expect(host.textContent).toContain("No new messages.");
    await vi.waitFor(() => expect(summaryText()).toBe("Your site is healthy"));
  });

  it("deep-links from a card's verb via navigate", async () => {
    const navigate = vi.fn<DashboardApi["open"]>();
    stubOverview({ content: { drafts: 1, unpublished: 0 }, inbox: { unread: 2 } });
    mount(() => <HomePanel cards={BUILTIN_CARDS} navigate={navigate} />);

    await vi.waitFor(() => expect(cardActionByLabel("Review pages")).toBeTruthy());
    cardActionByLabel("Review pages")!.click();
    expect(navigate).toHaveBeenCalledWith({ panel: "pages" });

    cardActionByLabel("Open inbox")!.click();
    expect(navigate).toHaveBeenCalledWith({ tab: "inquiries" });
  });

  it("appends site cards and hides built-ins by id", async () => {
    stubOverview({ inbox: { unread: 0 } });
    mount(() => (
      <HomePanel
        cards={[
          ...BUILTIN_CARDS.filter((c) => c.id !== "content"),
          { id: "shop", order: 100, render: () => <div class="louise-card-title">Shop</div> },
        ]}
        navigate={() => {}}
      />
    ));
    // Wait on the query-backed card (Inbox); the static Shop card renders at once.
    await vi.waitFor(() => expect(cardTitles()).toContain("Inbox"));
    expect(cardTitles()).toContain("Shop");
    // The hidden built-in (content) never renders.
    expect(cardTitles()).not.toContain("Content");
  });
});

describe("HomePanel — footer empty slot (#109)", () => {
  it("registers no footer actions, so the drawer footer collapses", async () => {
    stubOverview({ content: { drafts: 4, unpublished: 0 } });
    mount(() => (
      <PanelActionsProvider>
        <HomePanel cards={BUILTIN_CARDS} navigate={() => {}} />
        <DrawerFooter />
      </PanelActionsProvider>
    ));
    await vi.waitFor(() => expect(host.querySelector(".louise-card-title")).not.toBeNull());
    // A dashboard drives owner actions from its cards, not the footer.
    expect(host.querySelector(".louise-drawer-foot")).toBeNull();
  });
});
