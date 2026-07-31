// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/client/settings` — the Settings data layer: the shared TanStack Solid
// Query wiring and typed fetch helpers every Louise editor Settings uses. The
// shell (see ./shell) and framework panels build on this; sites reuse the same
// helpers for their own collection tabs so everything shares one query cache.

import { QueryClient } from "@tanstack/solid-query";

/**
 * A failed API call, carrying the HTTP status.
 *
 * The status is a property rather than only text in the message because callers
 * genuinely branch on it — the full-page studio redirects to sign-in on a 401,
 * and matching that by parsing an error string would break the first time the
 * message is reworded.
 */
export class LouiseApiError extends Error {
  readonly status: number;
  constructor(method: string, url: string, status: number) {
    super(`${method} ${url} ${status}`);
    this.name = "LouiseApiError";
    this.status = status;
  }
}

/** Whether an unknown thrown value is a {@link LouiseApiError} with this status. */
export function isApiStatus(error: unknown, status: number): boolean {
  return error instanceof LouiseApiError && error.status === status;
}

/**
 * The Settings' QueryClient. The Settings is a short-lived, editor-only surface
 * that opens over the live page, so: no window-focus refetch, a short stale
 * window to keep tab switches snappy without hammering the API, and one retry.
 */
export function createSettingsQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        // One retry for a flaky network — but never for a 401. An expired
        // session fails again a second later by definition, so retrying only
        // delays whatever the surface does about it (the studio redirects to
        // sign-in) by the length of the backoff.
        retry: (failureCount, error) => !isApiStatus(error, 401) && failureCount < 1,
      },
    },
  });
}

/**
 * A namespaced Settings query key, e.g. `louiseQueryKey("products", id)`. Sites
 * use this for their own collections; the framework-generic ones are in
 * {@link louiseQueryKeys}.
 */
export function louiseQueryKey(
  collection: string,
  ...rest: readonly (string | number)[]
): readonly [string, string, ...(string | number)[]] {
  return ["louise", collection, ...rest];
}

/** Query keys for the framework-generic collections. Sites add their own via
 *  {@link louiseQueryKey} (e.g. `products`, `artworks`). */
export const louiseQueryKeys = {
  pages: ["louise", "pages"],
  media: ["louise", "media"],
  settings: ["louise", "settings"],
  inquiries: ["louise", "inquiries"],
  editors: ["louise", "editors"],
  overview: ["louise", "overview"],
  health: ["louise", "health"],
} as const;

/** GET JSON, throwing {@link LouiseApiError} on a non-2xx status. */
export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new LouiseApiError("GET", url, res.status);
  return (await res.json()) as T;
}

/** Send JSON (POST/PATCH/DELETE/…) and parse the JSON response; throws
 *  {@link LouiseApiError} on a non-2xx status. */
export async function apiSend<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new LouiseApiError(method, url, res.status);
  return (await res.json()) as T;
}
