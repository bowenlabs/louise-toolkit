import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverWebhookMessage, type WebhookMessage } from "../../src/core/content/webhooks.js";
import { defineForm } from "../../src/core/forms/index.js";
import { notifySubmission } from "../../src/core/forms/notify.js";
import {
  BlockedUrlError,
  fetchPublicUrl,
  publicUrlProblem,
  UpstreamError,
} from "../../src/core/security/index.js";

// ADR 0012 §3: a URL someone else chose gets a policy on the URL and on every
// redirect hop, on top of upstreamFetch's timeout and safe error.

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; method: string; headers: Headers; body: unknown };

/** A fake internet: `routes[url]` answers that URL; anything else is a 404. */
function internet(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({
        url,
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: init.body,
      });
      return routes[url]?.() ?? new Response("not found", { status: 404 });
    }),
  );
  return calls;
}
const redirect = (status: number, location: string) => () =>
  new Response(null, { status, headers: { location } });

describe("publicUrlProblem", () => {
  const problem = (url: string, policy = {}) => publicUrlProblem(new URL(url), policy);

  it("allows an ordinary https URL", () => {
    expect(problem("https://hooks.example.com/abc")).toBeNull();
    expect(problem("https://hooks.example.com./abc")).toBeNull(); // trailing-dot FQDN
  });

  it("refuses what isn't a public https host on the default port", () => {
    for (const url of [
      "http://hooks.example.com/", // plain http
      "ftp://hooks.example.com/",
      "https://hooks.example.com:8443/", // non-default port
      "https://user:pw@hooks.example.com/", // credentials in the URL
      "https://127.0.0.1/",
      "https://2130706433/", // decimal 127.0.0.1 — the parser normalizes it
      "https://0x7f.1/", // hex/short form, same address
      "https://169.254.169.254/latest/meta-data", // cloud metadata
      "https://[::1]/",
      "https://[::ffff:7f00:1]/", // IPv4-mapped loopback
      "https://100.64.0.1/", // CGNAT — the old regex missed it
      "https://localhost/",
      "https://localhost./",
      "https://intranet/", // single label
      "https://printer.local/",
      "https://db.internal/",
      "https://router.home.arpa/",
      "https://app.localhost/",
    ]) {
      expect(problem(url), url).not.toBeNull();
    }
  });

  it("allows http only when asked", () => {
    expect(problem("http://hooks.example.com/", { allowHttp: true })).toBeNull();
    expect(problem("http://127.0.0.1/", { allowHttp: true })).not.toBeNull();
  });

  it("blocks the hosts you name, exactly or by domain", () => {
    const policy = { blockHosts: ["louisetoolkit.com", ".internal-corp.com"] };
    expect(problem("https://louisetoolkit.com/api", policy)).toMatch(/blocked host/);
    expect(problem("https://www.louisetoolkit.com/api", policy)).toBeNull(); // exact only
    expect(problem("https://internal-corp.com/", policy)).toMatch(/blocked host/);
    expect(problem("https://a.b.internal-corp.com/", policy)).toMatch(/blocked host/);
    expect(problem("https://notinternal-corp.com/", policy)).toBeNull();
  });
});

describe("fetchPublicUrl", () => {
  it("refuses a blocked URL before any request", async () => {
    const calls = internet({});
    const err = await fetchPublicUrl("https://169.254.169.254/latest").catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrlError);
    expect(calls).toHaveLength(0);
  });

  it("checks every redirect hop against the policy", async () => {
    const calls = internet({
      "https://ok.example.com/a": redirect(302, "https://ok.example.com/b"),
      "https://ok.example.com/b": redirect(302, "http://127.0.0.1/admin"),
    });
    const err = await fetchPublicUrl("https://ok.example.com/a").catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrlError);
    expect(err.reason).toMatch(/^redirect to/);
    expect(calls.map((c) => c.url)).toEqual([
      "https://ok.example.com/a",
      "https://ok.example.com/b",
    ]);
  });

  it("follows a GET's redirect to an acceptable host", async () => {
    internet({
      "https://ok.example.com/a": redirect(301, "/b"), // relative Location
      "https://ok.example.com/b": () => new Response("here"),
    });
    expect(await (await fetchPublicUrl("https://ok.example.com/a")).text()).toBe("here");
  });

  it("never follows a POST through a 301/302/303 — it would arrive as an empty GET", async () => {
    const calls = internet({
      "https://ok.example.com/hook": redirect(302, "https://ok.example.com/new"),
    });
    const res = await fetchPublicUrl("https://ok.example.com/hook", { method: "POST", body: "{}" });
    expect(res.status).toBe(302);
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("follows a POST through a 307, with its body, dropping credentials across origins", async () => {
    const calls = internet({
      "https://ok.example.com/hook": redirect(307, "https://other.example.com/hook"),
      "https://other.example.com/hook": () => new Response(null, { status: 204 }),
    });
    const res = await fetchPublicUrl("https://ok.example.com/hook", {
      method: "POST",
      headers: { authorization: "Bearer s3cret", "x-louise-signature": "abc" },
      body: '{"a":1}',
    });
    expect(res.status).toBe(204);
    expect(calls[1]).toMatchObject({ method: "POST", body: '{"a":1}' });
    expect(calls[1]?.headers.get("authorization")).toBeNull();
    expect(calls[1]?.headers.get("x-louise-signature")).toBe("abc");
  });

  it("stops after maxRedirects", async () => {
    internet({
      "https://ok.example.com/1": redirect(302, "https://ok.example.com/2"),
      "https://ok.example.com/2": redirect(302, "https://ok.example.com/1"),
    });
    const err = await fetchPublicUrl("https://ok.example.com/1", { maxRedirects: 3 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(BlockedUrlError);
    expect(err.reason).toBe("more than 3 redirects");
  });

  it("fails a network error the upstreamFetch way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("reset"))),
    );
    const err = await fetchPublicUrl("https://ok.example.com/", { provider: "Webhook" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toBe("Webhook request failed (no response)");
  });
});

describe("deliverWebhookMessage", () => {
  const message = (url: string): WebhookMessage => ({
    url,
    secret: "whsec",
    event: "update",
    doc: { id: 1, title: "Hello" },
    timestamp: 1_700_000_000_000,
  });

  it("POSTs the signed payload", async () => {
    const calls = internet({
      "https://hooks.example.com/T0/B0/secretpath": () => new Response(null, { status: 200 }),
    });
    await deliverWebhookMessage(message("https://hooks.example.com/T0/B0/secretpath"));
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.get("x-louise-signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      event: "update",
      doc: { id: 1, title: "Hello" },
      timestamp: 1_700_000_000_000,
    });
  });

  it("names the origin in its errors, never the path — a hook path is often the credential", async () => {
    internet({
      "https://hooks.example.com/T0/B0/secretpath": () => new Response("no", { status: 500 }),
    });
    const err = await deliverWebhookMessage(
      message("https://hooks.example.com/T0/B0/secretpath"),
    ).catch((e) => e);
    expect(err.message).toBe("Webhook delivery to https://hooks.example.com returned status 500");
    expect(err.message).not.toContain("secretpath");
  });

  it("refuses a private or plain-http endpoint, saying why", async () => {
    const calls = internet({});
    for (const url of ["https://10.0.0.5/hook", "http://hooks.example.com/hook"]) {
      const err = await deliverWebhookMessage(message(url)).catch((e) => e);
      expect(err.message, url).toMatch(/failed: /);
    }
    expect(calls).toHaveLength(0);
  });

  it("takes a policy — for example, the site's own host", async () => {
    const calls = internet({});
    const err = await deliverWebhookMessage(message("https://louisetoolkit.com/api/louise/save"), {
      blockHosts: ["louisetoolkit.com"],
    }).catch((e) => e);
    expect(err.message).toMatch(/blocked host/);
    expect(calls).toHaveLength(0);
  });
});

describe("notifySubmission webhook", () => {
  const form = (webhook: string) =>
    defineForm({
      name: "contact",
      fields: { email: { type: "email", label: "Email", required: true } },
      notify: { webhook },
    });

  it("posts the submission to a public endpoint", async () => {
    const calls = internet({
      "https://hooks.example.com/f": () => new Response(null, { status: 204 }),
    });
    await notifySubmission(form("https://hooks.example.com/f"), { email: "a@b.co" });
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      form: "contact",
      values: { email: "a@b.co" },
    });
  });

  it("drops a notify target that isn't public — without failing the submission", async () => {
    const calls = internet({});
    await expect(
      notifySubmission(form("https://169.254.169.254/latest"), { email: "a@b.co" }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
