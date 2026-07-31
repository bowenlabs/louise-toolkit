// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountStudio } from "../../src/client/studio/index.js";

const disposers: (() => void)[] = [];

beforeEach(() => {
  // Every panel fetches its own data on mount — that is the design, and it is
  // what keeps the shell free of baked-in state. Stub it so the assertions are
  // about the shell rather than about a network that isn't there.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of disposers.splice(0)) d();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-louise-studio");
});
const mount = (config: Parameters<typeof mountStudio>[0] = {}) => {
  const dispose = mountStudio(config);
  disposers.push(dispose);
  return dispose;
};

describe("mountStudio", () => {
  it("renders into a body-appended root by default", () => {
    mount();
    expect(document.getElementById("louise-studio-root")).not.toBeNull();
    expect(document.querySelector(".louise-studio")).not.toBeNull();
  });

  it("renders into a supplied element", () => {
    const host = document.createElement("main");
    host.id = "host";
    document.body.appendChild(host);
    mount({ target: host });
    expect(host.querySelector(".louise-studio")).not.toBeNull();
    // No body-appended root when the caller supplied a home for it.
    expect(document.getElementById("louise-studio-root")).toBeNull();
  });

  it("throws on a selector that matched nothing", () => {
    // Rendering nothing is the least useful way to report a wiring mistake.
    expect(() => mountStudio({ target: "#nope" })).toThrow(/no element matched/);
  });

  it("is idempotent on the default root, so a re-render can't stack two apps", () => {
    mount();
    mount();
    expect(document.querySelectorAll(".louise-studio")).toHaveLength(1);
  });

  it("renders NO session-specific markup — the shell must stay cacheable", () => {
    // The whole reason the page shell exists in this shape: identical HTML for
    // every editor, so a service worker can precache it. The title is static
    // config (a site name), never an editor name.
    mount({ title: "Acme Studio" });
    const html = document.querySelector(".louise-studio")?.innerHTML ?? "";
    expect(html).toContain("Acme Studio");
    // Panels fetch their own data; nothing is baked in at mount.
    expect(html).not.toMatch(/data-louise-editor|"email"/);
  });

  it("defaults the header to a neutral title", () => {
    mount();
    expect(document.querySelector(".louise-who-name")?.textContent).toBe("Studio");
  });

  it("shows the framework strip, and Users only when opted in", () => {
    mount();
    const labels = () =>
      [...document.querySelectorAll(".louise-frame-btn")].map((b) => b.getAttribute("aria-label"));
    expect(labels()).toEqual(["Home", "Media", "Pages", "Settings"]);

    for (const d of disposers.splice(0)) d();
    document.body.innerHTML = "";
    mount({ users: true });
    expect(labels()).toContain("Users");
  });

  it("renders site tabs alongside the framework panels", () => {
    mount({
      home: false,
      tabs: [{ id: "orders", label: "Orders", panel: () => <p>ORDERS</p> }],
    });
    const tabs = [...document.querySelectorAll(".louise-tab")].map((t) => t.textContent);
    expect(tabs).toEqual(["Orders"]);
  });

  it("disposes cleanly and takes its root with it", () => {
    const dispose = mountStudio({});
    expect(document.getElementById("louise-studio-root")).not.toBeNull();
    dispose();
    expect(document.getElementById("louise-studio-root")).toBeNull();
  });

  it("marks the document while mounted, so page-level CSS can apply", () => {
    const dispose = mountStudio({});
    expect(document.documentElement.hasAttribute("data-louise-studio")).toBe(true);
    dispose();
    expect(document.documentElement.hasAttribute("data-louise-studio")).toBe(false);
  });
});

describe("mountStudio — an expired session", () => {
  /** Drive one panel query to a 401 and see where the browser is sent. */
  const run = async (config: Parameters<typeof mountStudio>[0] = {}) => {
    const assigned: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, assign: (url: string) => assigned.push(url) },
    });
    const dispose = mountStudio(config);
    disposers.push(dispose);
    // Let the panel's query settle into its error state.
    await new Promise((r) => setTimeout(r, 80));
    Object.defineProperty(window, "location", { configurable: true, value: original });
    return assigned;
  };

  it("redirects to sign-in rather than rendering an empty app", async () => {
    // A full-page studio can't degrade to "show the public page" the way the
    // drawer can — there is no page underneath it. An expired session has to
    // become a navigation, or the editor stares at panels that silently fail.
    expect(await run()).toContain("/signin");
  });

  it("honours a custom signInPath", async () => {
    expect(await run({ signInPath: "/studio/login" })).toContain("/studio/login");
  });
});
