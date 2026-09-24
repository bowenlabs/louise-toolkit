// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/security—fetching a URL someone else chose (ADR 0012 §3).
//
// A provider API has a fixed host, so `upstreamFetch` only needs a timeout and
// no redirects. A webhook URL, a form's notify target—anything that came from
// content or a config a user can edit—can point anywhere, so it gets a policy
// on top, checked on the first request and again on every redirect hop.
//
// What the policy is for, on Workers: a Worker's fetch runs on Cloudflare's
// network, not inside a private network of ours, so "reach the metadata
// service" is not the main risk. The risks are the site's own zone (without
// `global_fetch_strictly_public`, a fetch to it goes straight to the origin,
// past the WAF and any Worker on that route), authenticated endpoints elsewhere
// reached with the site's standing, and a redirect from an acceptable host to
// one that isn't. A hostname can still resolve to anything, and there is no DNS
// lookup to check it against here, so this narrows what can be asked for, and
// the compatibility flag closes the own-zone path; neither alone is the whole
// defense.

import { upstreamFetch, type UpstreamFetchInit } from "./upstream.js";

export interface PublicUrlPolicy {
  /** Allow plain `http:`. Default `false`: a payload sent over http can be read
   *  and rewritten on the way. */
  allowHttp?: boolean;
  /**
   * Hosts the URL must not target, on top of the built-in names. An entry
   * starting with `.` matches that domain and every subdomain. Pass your own
   * site's host: a webhook pointed back at the site is a request with the
   * site's standing.
   */
  blockHosts?: readonly string[];
}

export interface FetchPublicUrlInit extends Omit<UpstreamFetchInit, "provider">, PublicUrlPolicy {
  /** Names the error. Default `"Remote"`. */
  provider?: string;
  /** Redirect hops to follow, each checked against the policy. Default 3. */
  maxRedirects?: number;
}

/** A URL the policy refuses—never retryable; the URL itself is the problem. */
export class BlockedUrlError extends Error {
  /** Why, in a few words—for logs and for the person fixing the config. */
  readonly reason: string;
  constructor(reason: string) {
    super(`URL not allowed: ${reason}`);
    this.name = "BlockedUrlError";
    this.reason = reason;
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// Names that only mean something on a private network (RFC 6761/6762/8375),
// plus the conventional internal ones.
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet"];

/**
 * Why `url` may not be fetched, or `null` when it may. The URL parser has
 * already normalized the tricks—`http://2130706433/` and `http://0x7f.1/`
 * both parse to `127.0.0.1`—so the checks run on what would actually be
 * requested.
 */
export function publicUrlProblem(url: URL, policy: PublicUrlPolicy = {}): string | null {
  if (url.protocol !== "https:" && !(policy.allowHttp && url.protocol === "http:")) {
    return `scheme ${url.protocol} (https only)`;
  }
  if (url.port !== "") return `non-default port ${url.port}`;
  if (url.username || url.password) return "credentials in the URL";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || IPV4.test(host)) return `IP address ${host} (use a hostname)`;
  if (!host.includes(".")) return `single-label host ${host}`;
  if (host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) {
    return `private-network name ${host}`;
  }
  for (const blocked of policy.blockHosts ?? []) {
    const b = blocked.toLowerCase();
    if (b.startsWith(".") ? host === b.slice(1) || host.endsWith(b) : host === b) {
      return `blocked host ${host}`;
    }
  }
  return null;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
// On a hop to another origin a browser drops these; so do we.
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/**
 * {@link upstreamFetch} for a URL someone else chose: the same timeout and safe
 * error, plus {@link publicUrlProblem}'s policy on the URL and on every
 * redirect hop (at most `maxRedirects`, default 3). Throws
 * {@link BlockedUrlError} for a URL the policy refuses.
 *
 * Only a GET or HEAD follows any redirect. Anything else follows only a 307 or
 * 308, which keep the method and body: a 301/302/303 turns a POST into a GET
 * and drops the body, so a webhook would "succeed" with nothing delivered.
 * That 3xx is returned instead, as the non-ok response it is. A body followed
 * through a 307/308 is sent again, so pass a string or bytes, not a stream.
 */
export async function fetchPublicUrl(
  input: string | URL,
  init: FetchPublicUrlInit = {},
): Promise<Response> {
  const { provider = "Remote", maxRedirects = 3, allowHttp, blockHosts, ...request } = init;
  const policy: PublicUrlPolicy = {
    ...(allowHttp === undefined ? {} : { allowHttp }),
    ...(blockHosts === undefined ? {} : { blockHosts }),
  };
  const method = (request.method ?? "GET").toUpperCase();
  const followsAny = method === "GET" || method === "HEAD";

  let url: URL;
  try {
    url = new URL(String(input));
  } catch {
    throw new BlockedUrlError("not a URL");
  }
  let headers = new Headers(request.headers);

  for (let hop = 0; ; hop++) {
    const problem = publicUrlProblem(url, policy);
    if (problem) throw new BlockedUrlError(hop === 0 ? problem : `redirect to ${problem}`);

    const res = await upstreamFetch(url, { ...request, headers, provider, redirect: "manual" });
    const location = res.headers.get("location");
    if (!REDIRECTS.has(res.status) || !location) return res;
    if (!followsAny && res.status !== 307 && res.status !== 308) return res;
    if (hop >= maxRedirects) throw new BlockedUrlError(`more than ${maxRedirects} redirects`);

    const next = new URL(location, url);
    if (next.origin !== url.origin) {
      headers = new Headers(headers);
      for (const name of CREDENTIAL_HEADERS) headers.delete(name);
    }
    url = next;
  }
}
