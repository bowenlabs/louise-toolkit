// The settings drawer says why a save failed (#592): the server's reason instead
// of a request line, each refused field marked and described, Save that stays
// enabled, link rows whose controls name their row, and links typed without a
// scheme.

import { QueryClientProvider } from "@tanstack/solid-query";
import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeLinkHref } from "../../src/client/settings/fields.jsx";
import {
  apiErrorMessage,
  apiSend,
  createSettingsQueryClient,
  DrawerFooter,
  type LinkRow,
  LinkListEditor,
  PagesPanel,
  PanelActionsProvider,
  SettingsPanel,
  UsersPanel,
} from "../../src/client/settings/index.js";
import { LouiseApiError } from "../../src/client/settings/query.js";
import { fieldErrorsFrom } from "../../src/client/settings/settings-panel.jsx";

let host: HTMLElement;
let dispose: (() => void) | undefined;

function mountPanel(ui: () => JSX.Element) {
  const qc = createSettingsQueryClient();
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <QueryClientProvider client={qc}>
        <PanelActionsProvider>
          {ui()}
          <DrawerFooter />
        </PanelActionsProvider>
      </QueryClientProvider>
    ),
    host,
  );
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(handler: (url: string, method: string, init?: RequestInit) => Response) {
  const mock = vi.fn((input: string | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), (init?.method ?? "GET").toUpperCase(), init)),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

const footSave = () =>
  host.querySelector<HTMLButtonElement>('.louise-drawer-foot [data-action="save"]')!;
const footStatus = () => host.querySelector(".louise-foot-status")?.textContent;
const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiErrorMessage", () => {
  it("shows a 4xx route's own reason", async () => {
    stubFetch(() => jsonResponse({ error: "“admin” is a reserved path." }, 422));
    const err = await apiSend("PATCH", "/api/louise/pages/3", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LouiseApiError);
    expect(apiErrorMessage(err, "Couldn’t save")).toBe("“admin” is a reserved path.");
  });

  it("never shows a 5xx's message, a request line, or a network error", () => {
    expect(
      apiErrorMessage(new LouiseApiError("POST", "/x", 500, { error: "D1 exploded" }), "F"),
    ).toBe("F");
    expect(apiErrorMessage(new LouiseApiError("POST", "/x", 422), "F")).toBe("F");
    expect(apiErrorMessage(new TypeError("fetch failed"), "F")).toBe("F");
  });

  it("keeps the violations a 422 sends", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: "1 field needs attention.",
          violations: [{ path: "siteName", message: "Bad" }, 5],
        },
        422,
      ),
    );
    const err = (await apiSend("POST", "/api/louise/settings", {}).catch(
      (e: unknown) => e,
    )) as LouiseApiError;
    expect(err.body.violations).toEqual([{ path: "siteName", message: "Bad" }]);
  });
});

describe("fieldErrorsFrom", () => {
  it("maps a path onto its field, and a list path onto its row", () => {
    expect(
      fieldErrorsFrom([
        { path: "logoUrl", message: "A" },
        { path: "navLinks[1].href", message: "B" },
        { path: "navLinks[3].href", message: "C" },
      ]),
    ).toEqual({ field: { logoUrl: "A" }, rows: { navLinks: { 1: "B", 3: "C" } } });
  });
});

describe("normalizeLinkHref", () => {
  it("adds https:// to a link that starts with a host", () => {
    expect(normalizeLinkHref("example.com/shop")).toBe("https://example.com/shop");
    expect(normalizeLinkHref("www.example.com")).toBe("https://www.example.com");
    expect(normalizeLinkHref("shop.example.com:8080?a=1")).toBe(
      "https://shop.example.com:8080?a=1",
    );
  });

  it("leaves everything else alone", () => {
    for (const href of [
      "https://example.com",
      "/shop",
      "#top",
      "mailto:alex@example.com",
      "alex@example.com",
      "javascript:alert(1)",
      "shop",
      "",
    ]) {
      expect(normalizeLinkHref(href)).toBe(href);
    }
  });
});

describe("SettingsPanel—a refused save", () => {
  it("marks the refused link row, counts it in the footer, and focuses it", async () => {
    stubFetch((url, method) => {
      if (method === "GET") {
        return jsonResponse({ settings: { navLinks: [{ label: "Shop", href: "ftp://x" }] } });
      }
      return jsonResponse(
        {
          error: "1 field needs attention.",
          violations: [
            {
              path: "navLinks[0].href",
              message: "Enter a link that starts with https://, mailto:, or /.",
            },
          ],
        },
        422,
      );
    });
    mountPanel(() => <SettingsPanel />);
    await vi.waitFor(() => expect(host.querySelector("[data-row]")).not.toBeNull());
    const href = host.querySelectorAll<HTMLInputElement>("[data-row='0'] input")[1]!;
    type(href, "ftp://y");
    footSave().click();

    await vi.waitFor(() => expect(footStatus()).toBe("1 field needs attention."));
    expect(href.getAttribute("aria-invalid")).toBe("true");
    const message = document.getElementById(href.getAttribute("aria-describedby")!);
    expect(message?.textContent).toBe("Enter a link that starts with https://, mailto:, or /.");
    await vi.waitFor(() => expect(document.activeElement).toBe(href));
    expect(href.closest("details")?.open).toBe(true);

    // Editing the field clears its message.
    type(href, "/shop");
    expect(href.getAttribute("aria-invalid")).toBeNull();
  });

  it("adds https:// to a link typed without a scheme before it saves", async () => {
    // Answers GET with whatever the last POST saved, as the route does.
    let navLinks: unknown = [{ label: "Shop", href: "/shop" }];
    const fetchMock = stubFetch((_url, method, init) => {
      if (method === "GET") return jsonResponse({ settings: { navLinks } });
      navLinks = JSON.parse(String(init?.body)).navLinks;
      return jsonResponse({ ok: true });
    });
    mountPanel(() => <SettingsPanel />);
    await vi.waitFor(() => expect(host.querySelector("[data-row]")).not.toBeNull());
    const href = host.querySelectorAll<HTMLInputElement>("[data-row='0'] input")[1]!;
    type(href, "example.com/shop");
    footSave().click();

    await vi.waitFor(() => expect(footStatus()).toContain("Saved"));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body)).navLinks).toEqual([
      { label: "Shop", href: "https://example.com/shop" },
    ]);
    expect(href.value).toBe("https://example.com/shop");
  });

  it("says a 5xx couldn't save, without the request line", async () => {
    stubFetch((_url, method) =>
      method === "GET"
        ? jsonResponse({ settings: { siteName: "Example Organization" } })
        : jsonResponse({ error: "D1_ERROR: no such table" }, 500),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    mountPanel(() => <SettingsPanel />);
    await vi.waitFor(() => expect(host.querySelector("#louise-set-siteName")).not.toBeNull());
    type(host.querySelector<HTMLInputElement>("#louise-set-siteName")!, "Renamed");
    footSave().click();
    await vi.waitFor(() => expect(footStatus()).toBe("Couldn’t save"));
  });

  it("says there's nothing to revert", async () => {
    stubFetch(() => jsonResponse({ settings: {} }));
    mountPanel(() => <SettingsPanel />);
    await vi.waitFor(() => expect(footSave()).not.toBeNull());
    host.querySelector<HTMLButtonElement>('.louise-drawer-foot [data-action="revert"]')!.click();
    await vi.waitFor(() => expect(footStatus()).toBe("No changes to revert"));
  });
});

describe("PagesPanel—a refused save", () => {
  it("shows the route's reason, never the request line", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch((url, method) => {
      if (url.endsWith("/api/louise/pages") && method === "GET") {
        return jsonResponse({ pages: [{ id: 3, title: "Terms", slug: "terms", status: "draft" }] });
      }
      if (method === "GET") {
        return jsonResponse({ page: { id: 3, title: "Terms", slug: "terms", status: "draft" } });
      }
      return jsonResponse({ error: "“admin” is a reserved path." }, 422);
    });
    mountPanel(() => <PagesPanel />);
    await vi.waitFor(() => expect(host.textContent).toContain("Terms"));
    host.querySelector<HTMLButtonElement>('button[aria-label="Page settings"]')!.click();
    await vi.waitFor(() =>
      expect(host.querySelector<HTMLInputElement>("#pg-slug")?.value).toBe("terms"),
    );
    type(host.querySelector<HTMLInputElement>("#pg-slug")!, "admin");
    footSave().click();
    await vi.waitFor(() => expect(host.textContent).toContain("“admin” is a reserved path."));
    expect(host.textContent).not.toContain("PATCH /api/louise/pages/3");
  });
});

describe("PagesPanel—the published page link (#598)", () => {
  it("says it opens a new tab, in words", async () => {
    stubFetch((url) =>
      url.endsWith("/api/louise/pages")
        ? jsonResponse({ pages: [{ id: 3, title: "Terms", slug: "terms", status: "published" }] })
        : jsonResponse({ page: { id: 3, title: "Terms", slug: "terms", status: "published" } }),
    );
    mountPanel(() => <PagesPanel />);
    await vi.waitFor(() => expect(host.textContent).toContain("Terms"));
    host.querySelector<HTMLButtonElement>('button[aria-label="Page settings"]')!.click();
    await vi.waitFor(() => expect(host.querySelector('a[target="_blank"]')).not.toBeNull());
    const link = host.querySelector<HTMLAnchorElement>('a[target="_blank"]')!;
    expect(link.textContent?.trim()).toBe("View published page (opens in a new tab)");
    expect(link.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});

describe("LinkListEditor", () => {
  function mountLinks(initial: LinkRow[]) {
    const [rows, setRows] = createSignal(initial);
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <LinkListEditor rows={rows()} setRows={setRows} />, host);
    return rows;
  }
  const button = (name: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

  it("names each control by its row, and labels the inputs visibly", () => {
    mountLinks([
      { label: "Home", href: "/" },
      { label: "Shop", href: "/shop" },
    ]);
    expect(button("Remove link 2, Shop")).not.toBeNull();
    expect(button("Move link 2, Shop up")).not.toBeNull();
    expect(button("Move link 1, Home down")).not.toBeNull();
    const [label, link] = host.querySelectorAll<HTMLInputElement>("[data-row='0'] input");
    expect(host.querySelector(`label[for="${label!.id}"]`)?.textContent).toBe("Label");
    expect(host.querySelector(`label[for="${link!.id}"]`)?.textContent).toBe("Link");
  });

  it("focuses the new row's label after Add", async () => {
    mountLinks([{ label: "Home", href: "/" }]);
    host.querySelector<HTMLButtonElement>(".louise-btn")!.click();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector("[data-row='1'] input")),
    );
  });

  it("focuses the next row's Remove after Remove, and Add link once the list is empty", async () => {
    mountLinks([
      { label: "Home", href: "/" },
      { label: "Shop", href: "/shop" },
    ]);
    button("Remove link 1, Home")!.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Remove link 1, Shop")));
    button("Remove link 1, Shop")!.click();
    await vi.waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.textContent).toContain("Add link"),
    );
  });

  it("adds https:// to a scheme-less link when the field loses focus", () => {
    const rows = mountLinks([{ label: "Shop", href: "" }]);
    const link = host.querySelectorAll<HTMLInputElement>("[data-row='0'] input")[1]!;
    type(link, "example.com/shop");
    link.dispatchEvent(new FocusEvent("blur"));
    expect(rows()[0]!.href).toBe("https://example.com/shop");
  });
});

describe("UsersPanel—inviting an editor", () => {
  const editors = { editors: [{ id: "1", name: "Alex", email: "alex@example.com" }] };

  it("keeps Add editor enabled and asks for the email when it's missing", async () => {
    const fetchMock = stubFetch(() => jsonResponse(editors));
    mountPanel(() => <UsersPanel />);
    await vi.waitFor(() => expect(host.textContent).toContain("Alex"));
    const add = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Add editor",
    )!;
    expect(add.disabled).toBe(false);
    add.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Enter the editor’s email address."));
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  it("sends one name, and shows the route's reason when it refuses", async () => {
    const fetchMock = stubFetch((_url, method) =>
      method === "GET"
        ? jsonResponse(editors)
        : jsonResponse({ error: "That email is already an editor." }, 409),
    );
    mountPanel(() => <UsersPanel />);
    await vi.waitFor(() => expect(host.textContent).toContain("Alex"));
    type(host.querySelector<HTMLInputElement>("#louise-invite-name")!, "Kai");
    type(host.querySelector<HTMLInputElement>("#louise-invite-email")!, "kai@example.com");
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Add editor")!
      .click();
    await vi.waitFor(() => expect(host.textContent).toContain("That email is already an editor."));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ name: "Kai", email: "kai@example.com" });
  });
});
