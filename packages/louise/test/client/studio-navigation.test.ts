import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeNavItem,
  focusScreenHeading,
  revealActiveNavLink,
  screenTitle,
  studioBasepath,
  studioHref,
} from "../../src/client/studio/navigation.js";

// Pulled up from themidwestartist.com's routed studio (#488), which is served
// under /studio on the apex and at the root of a studio. subdomain.

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/orders", label: "Orders" },
  { to: "/orders/archive", label: "Archive" },
  { to: "/products", label: "Shop" },
];

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("studioBasepath", () => {
  it("is the prefix when the page loaded under it, else the root", () => {
    expect(studioBasepath("/studio", "/studio")).toBe("/studio");
    expect(studioBasepath("/studio", "/studio/orders/42")).toBe("/studio");
    // The subdomain: a host rewrite adds /studio on the server; the browser
    // never sees it.
    expect(studioBasepath("/studio", "/orders/42")).toBe("/");
  });

  it("matches whole segments — /studios is not the studio", () => {
    expect(studioBasepath("/studio", "/studios")).toBe("/");
    expect(studioBasepath("/studio", "/studio-tour")).toBe("/");
  });

  it("accepts the prefix with or without slashes, and refuses an empty one", () => {
    expect(studioBasepath("studio/", "/studio/x")).toBe("/studio");
    expect(() => studioBasepath("/", "/x")).toThrow(RangeError);
  });
});

describe("studioHref", () => {
  it("resolves a page outside the router for whichever host the studio is on", () => {
    expect(studioHref("/studio", "print/labels", "/studio/locations")).toBe("/studio/print/labels");
    // Hard-coding /studio/… here would become /studio/studio/… through the
    // host rewrite and 404.
    expect(studioHref("/studio", "/print/labels", "/locations")).toBe("/print/labels");
  });
});

describe("activeNavItem / screenTitle", () => {
  it("picks the longest matching entry, by whole segments", () => {
    expect(activeNavItem(NAV, "/orders/42")?.label).toBe("Orders");
    expect(activeNavItem(NAV, "/orders/archive/7")?.label).toBe("Archive");
    expect(activeNavItem(NAV, "/ordersheet")).toBeNull();
  });

  it("matches the root only exactly", () => {
    expect(activeNavItem(NAV, "/")?.label).toBe("Overview");
    expect(activeNavItem(NAV, "/unknown")).toBeNull();
  });

  it("words a title with the suffix, and falls back when nothing matches", () => {
    expect(screenTitle(NAV, "/products", { suffix: "Acme Studio" })).toBe("Shop — Acme Studio");
    expect(screenTitle(NAV, "/products")).toBe("Shop");
    expect(screenTitle(NAV, "/nope", { suffix: "Acme Studio" })).toBe("Acme Studio");
    expect(screenTitle(NAV, "/nope")).toBe("Studio");
    expect(screenTitle(NAV, "/nope", { fallback: "Admin" })).toBe("Admin");
    expect(screenTitle(NAV, "/", { suffix: "S", separator: " | " })).toBe("Overview | S");
  });
});

describe("focusScreenHeading", () => {
  it("focuses the heading on the next frame, without making it tabbable", async () => {
    document.body.innerHTML = `<main><h1>Orders</h1></main>`;
    focusScreenHeading(document.querySelector("main"));
    const h1 = document.querySelector("h1")!;
    expect(document.activeElement).not.toBe(h1);
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.activeElement).toBe(h1);
    // Focusable by script, not reachable by Tab.
    expect(h1.tabIndex).toBe(-1);
  });

  it("leaves an authored tabindex alone", async () => {
    document.body.innerHTML = `<main><h1 tabindex="0">Orders</h1></main>`;
    focusScreenHeading(document.querySelector("main"));
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.querySelector("h1")!.getAttribute("tabindex")).toBe("0");
  });

  it("does nothing once cancelled — a navigation superseded before the frame", async () => {
    document.body.innerHTML = `<main><h1>Orders</h1></main>`;
    focusScreenHeading(document.querySelector("main"))();
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.activeElement).not.toBe(document.querySelector("h1"));
  });

  it("tolerates a screen with no heading", async () => {
    document.body.innerHTML = `<main><p>Loading…</p></main>`;
    focusScreenHeading(document.querySelector("main"));
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.activeElement).toBe(document.body);
  });
});

describe("revealActiveNavLink", () => {
  const navWith = (scrollWidth: number, clientWidth: number) => {
    document.body.innerHTML = `<nav><a href="/">A</a><a href="/z" aria-current="page">Z</a></nav>`;
    const nav = document.querySelector("nav")!;
    Object.defineProperty(nav, "scrollWidth", { value: scrollWidth });
    Object.defineProperty(nav, "clientWidth", { value: clientWidth });
    const link = nav.querySelector<HTMLElement>('[aria-current="page"]')!;
    link.scrollIntoView = vi.fn();
    return { nav, link };
  };

  it("scrolls the active link into view when the row overflows", () => {
    const { nav, link } = navWith(900, 320);
    revealActiveNavLink(nav);
    expect(link.scrollIntoView).toHaveBeenCalledWith({ inline: "center", block: "nearest" });
  });

  it("does nothing when the row fits", () => {
    const { nav, link } = navWith(320, 320);
    revealActiveNavLink(nav);
    expect(link.scrollIntoView).not.toHaveBeenCalled();
  });
});
