import { QueryClient } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiGet,
  apiSend,
  createSettingsQueryClient,
  louiseQueryKey,
  louiseQueryKeys,
} from "../../src/client/settings/query.js";

describe("createSettingsQueryClient", () => {
  it("returns a QueryClient with editor-tuned defaults", () => {
    const client = createSettingsQueryClient();
    expect(client).toBeInstanceOf(QueryClient);
    const q = client.getDefaultOptions().queries;
    expect(q?.refetchOnWindowFocus).toBe(false);
    expect(q?.staleTime).toBe(30_000);
    expect(q?.retry).toBe(1);
  });
});

describe("query keys", () => {
  it("namespaces dynamic keys under louise", () => {
    expect(louiseQueryKey("products", 5)).toEqual(["louise", "products", 5]);
  });

  it("exposes the framework-generic keys", () => {
    expect(louiseQueryKeys.pages).toEqual(["louise", "pages"]);
    expect(louiseQueryKeys.media).toEqual(["louise", "media"]);
    expect(louiseQueryKeys.settings).toEqual(["louise", "settings"]);
  });
});

describe("apiGet / apiSend", () => {
  afterEach(() => vi.unstubAllGlobals());

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it("apiGet parses JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: 1 })),
    );
    expect(await apiGet<{ ok: number }>("/api/x")).toEqual({ ok: 1 });
  });

  it("apiGet throws on a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await expect(apiGet("/api/x")).rejects.toThrow("GET /api/x 500");
  });

  it("apiSend sends the method + JSON body and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ id: 7 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await apiSend<{ id: number }>("PATCH", "/api/y", { a: 1 })).toEqual({ id: 7 });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ a: 1 }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("apiSend omits the body when none is given", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await apiSend("POST", "/api/z");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it("apiSend throws on a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    await expect(apiSend("POST", "/api/y")).rejects.toThrow("POST /api/y 403");
  });
});
