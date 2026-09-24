import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/solid-router";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { StudioShell } from "../../src/client/studio-shell/index.js";

// The routed studio frame on a real TanStack router (memory history), so what's
// under test is the wiring: title per screen, focus after a navigation but not
// on first load, the skip link, and a basepath.

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/orders", label: "Orders" },
] as const;

const frame = () => new Promise((r) => requestAnimationFrame(r));
/** Long enough for the router to resolve a navigation and the frame after it. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await frame();
};

function mountRouted(initial: string, basepath = "/") {
  const rootRoute = createRootRoute({
    component: () => (
      <StudioShell nav={NAV} brand={<span>Acme</span>} title={{ suffix: "Acme Studio" }} />
    ),
  });
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <h1>Overview</h1>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/orders",
      component: () => <h1>Orders</h1>,
    }),
  ]);
  const router = createRouter({
    routeTree,
    basepath,
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(() => <RouterProvider router={router} />, host);
  return { router, host, dispose };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
  document.title = "";
});

describe("StudioShell", () => {
  it("titles the screen it loaded on, and doesn't move focus on first load", async () => {
    const { dispose } = mountRouted("/orders");
    cleanup = dispose;
    await settle();
    expect(document.title).toBe("Orders — Acme Studio");
    expect(document.activeElement).toBe(document.body);
  });

  it("after a navigation, retitles and moves focus to the new screen's heading", async () => {
    const { router, host, dispose } = mountRouted("/");
    cleanup = dispose;
    await settle();
    expect(document.title).toBe("Overview — Acme Studio");

    await router.navigate({ to: "/orders" });
    await settle();
    expect(document.title).toBe("Orders — Acme Studio");
    const h1 = host.querySelector("main h1");
    expect(h1?.textContent).toBe("Orders");
    expect(document.activeElement).toBe(h1);
  });

  it("marks the active link, and names the nav", async () => {
    const { host, dispose } = mountRouted("/orders");
    cleanup = dispose;
    await settle();
    const nav = host.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe("Studio");
    const current = nav?.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe("Orders");
    // The root entry is exact: it isn't also current on /orders.
    expect(nav?.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("has a skip link that moves focus to the main region without navigating", async () => {
    const { router, host, dispose } = mountRouted("/orders");
    cleanup = dispose;
    await settle();
    const skip = host.querySelector<HTMLAnchorElement>(".louise-studio-shell-skip");
    expect(skip?.textContent).toBe("Skip to content");
    // First in tab order: before the header and nav.
    expect(host.querySelector(".louise-studio-shell")?.firstElementChild).toBe(skip);
    skip?.click();
    expect(document.activeElement).toBe(host.querySelector("main"));
    expect(router.state.location.pathname).toBe("/orders");
    // Hidden until focused—the rule is injected once, whatever mounts.
    expect(document.querySelectorAll("#louise-studio-shell-style")).toHaveLength(1);
  });

  it("links under the basepath when the studio is mounted under a prefix", async () => {
    const { host, dispose } = mountRouted("/studio/orders", "/studio");
    cleanup = dispose;
    await settle();
    expect(document.title).toBe("Orders — Acme Studio");
    const hrefs = [...host.querySelectorAll("nav a")].map((a) => a.getAttribute("href"));
    // The router's own form: the root under a basepath is written with its
    // trailing slash.
    expect(hrefs).toEqual(["/studio/", "/studio/orders"]);
  });
});
