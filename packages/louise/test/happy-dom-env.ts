// Custom happy-dom test environment (the #10 happy-dom blocker fix).
//
// The project builds/tests through the curl-installed Vite+ (`vp`) toolchain,
// whose bundled vitest lives outside the workspace (~/.vite-plus/…). vitest's
// *builtin* happy-dom environment does a bare `import('happy-dom')` from its own
// bundled location, so it can't find happy-dom in the workspace node_modules and
// the client test project fails to start.
//
// A *path-named* environment is instead loaded through the project's module
// runner (rooted at packages/louise), so THIS file's `import('happy-dom')`
// resolves from the workspace. We mirror vitest's builtin happy-dom `setup`,
// using the public `populateGlobal` helper from `vitest/environments`.

import { populateGlobal } from "vitest/environments";

interface HappyDOMOptions {
  url?: string;
  settings?: Record<string, unknown>;
}

interface HappyWindow {
  close?: () => void;
  happyDOM?: { abort?: () => Promise<void>; cancelAsync?: () => void };
}

async function teardownWindow(win: HappyWindow): Promise<void> {
  if (win.close && win.happyDOM?.abort) {
    await win.happyDOM.abort();
    win.close();
  } else {
    win.happyDOM?.cancelAsync?.();
  }
}

export default {
  name: "happy-dom",
  viteEnvironment: "client",
  async setup(global: typeof globalThis, options: { happyDOM?: HappyDOMOptions } = {}) {
    const happyDOM = options.happyDOM ?? {};
    // happy-dom v3+ exposes GlobalWindow for the pre-v3 Window behaviour.
    const mod = (await import("happy-dom")) as unknown as {
      Window: new (o: unknown) => HappyWindow;
      GlobalWindow?: new (o: unknown) => HappyWindow;
    };
    const Ctor = mod.GlobalWindow || mod.Window;
    const win = new Ctor({
      ...happyDOM,
      console: global.console,
      url: happyDOM.url || "http://localhost:3000",
      settings: { ...happyDOM.settings, disableErrorCapturing: true },
    });
    const { keys, originals } = populateGlobal(global, win, {
      bindFunctions: true,
      additionalKeys: [
        "Request",
        "Response",
        "MessagePort",
        "fetch",
        "Headers",
        "AbortController",
        "AbortSignal",
        "URL",
        "URLSearchParams",
        "FormData",
      ],
    });
    return {
      async teardown(g: typeof globalThis) {
        await teardownWindow(win);
        const target = g as Record<string | symbol, unknown>;
        keys.forEach((key: string | symbol) => {
          delete target[key];
        });
        originals.forEach((value: unknown, key: string | symbol) => {
          target[key] = value;
        });
      },
    };
  },
};
