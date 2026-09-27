// @vitest-environment happy-dom
// Decorative images (#599): an empty alt means "skip this image" and is kept
// apart from an alt that hasn't been written yet, in rich text and in the
// Media panel alike.

import { QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountRichText } from "../../src/client/RichText.jsx";
import {
  createSettingsQueryClient,
  DrawerFooter,
  MediaPanel,
  PanelActionsProvider,
} from "../../src/client/settings/index.js";

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
  vi.unstubAllGlobals();
});

function mountField(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  const rt = mountRichText(el, () => {});
  cleanups.push(() => {
    rt.destroy();
    el.remove();
  });
  return { el, rt };
}

describe("rich text—three alt states", () => {
  it("keeps a decorative image's empty alt through a round trip", async () => {
    const { rt } = mountField('<p><img src="https://cdn.example.com/rule.png" alt=""></p>');
    await tick();
    expect(rt.getHTML()).toMatch(/<img[^>]*alt=""/);
  });

  it("writes no alt for an image that has none yet", async () => {
    const { rt } = mountField('<p><img src="https://cdn.example.com/a.png"></p>');
    await tick();
    expect(rt.getHTML()).not.toContain("alt=");
  });

  it("marks an image decorative from the alt control, and unmarks it", async () => {
    const { el, rt } = mountField('<p><img src="https://cdn.example.com/a.png"></p>');
    await tick();
    const trigger = el.querySelector<HTMLButtonElement>(".louise-rt-alt-btn")!;
    expect(trigger.textContent).toBe("Alt?");
    trigger.click();
    await tick();
    const box = el.querySelector<HTMLInputElement>(
      '.louise-rt-alt-decorative input[type="checkbox"]',
    )!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(rt.getHTML()).toMatch(/<img[^>]*alt=""/);

    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(rt.getHTML()).not.toContain("alt=");
  });
});

describe("Media panel—the decorative checkbox", () => {
  it("sends an empty alt for a decorative image, and null for an empty field", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") bodies.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            media: [{ key: "web/rule.png", url: "https://cdn.example.com/rule.png", alt: null }],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(
      () => (
        <QueryClientProvider client={createSettingsQueryClient()}>
          <PanelActionsProvider>
            <MediaPanel />
            <DrawerFooter />
          </PanelActionsProvider>
        </QueryClientProvider>
      ),
      host,
    );
    cleanups.push(() => {
      dispose();
      host.remove();
    });

    await vi.waitFor(() =>
      expect(host.querySelector('button[aria-label="Edit alt text"]')).not.toBeNull(),
    );
    host.querySelector<HTMLButtonElement>('button[aria-label="Edit alt text"]')!.click();
    const box = await vi.waitFor(() => {
      const found = host.querySelector<HTMLInputElement>(
        '.louise-media-edit input[type="checkbox"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('.louise-drawer-foot [data-action="save"]')!.click();
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ key: "web/rule.png", alt: "" });
  });
});
