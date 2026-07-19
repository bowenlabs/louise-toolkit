// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Byte-range serving from R2 — the plumbing under the self-hosted basemap.
//
// A PMTiles archive is one immutable blob, often hundreds of megabytes, and the
// client reads a few kilobytes at a time: a header, then directory pages, then
// individual tiles. That only works if the server honours HTTP range requests,
// which is the whole reason this file exists rather than a plain R2 passthrough.
//
// Serving it same-origin (rather than off a media domain) is what keeps the CSP
// at `connect-src 'self'` with no external tile host and no API key, and
// sidesteps any CORS policy on the bucket.
//
// The range parsing is deliberately complete. The implementation this
// generalizes matched only `bytes=<start>-<end?>`, so a SUFFIX range
// (`bytes=-20000`, "the last 20 KB" — how a client reads a footer without
// knowing the length) fell through to serving the ENTIRE archive. That is a
// correct-looking response and a catastrophic one.

/**
 * A byte range, shaped to be assignable to Cloudflare's `R2Range`.
 *
 * All-optional fields would NOT be: `R2Range` is a union whose members each
 * require something (`{offset, length?}` | `{suffix}`), so a loose shape
 * satisfies none of them.
 */
export type RangeSpec = { offset: number; length?: number } | { suffix: number };

/**
 * How the archive is read. A function rather than a bucket interface, and
 * deliberately so: `R2Bucket.get` is overloaded, and its first overload
 * *requires* an options argument — which means no structural interface with an
 * optional second parameter can accept a real `R2Bucket`. Taking a reader lets
 * the call site use R2's own types and resolves the mismatch at the source, and
 * incidentally makes this work over any storage rather than only R2.
 */
export type RangeReader = (range?: RangeSpec) => Promise<RangeObject | null>;

export interface RangeObject {
  /**
   * Optional because `R2Bucket.get` is overloaded and its conditional form
   * resolves to `R2Object`, which carries no body at all. Requiring one here
   * makes a real `R2Bucket` fail to satisfy this interface.
   */
  body?: ReadableStream | null;
  /** Size of the WHOLE object, not the returned slice. */
  size: number;
  /** What R2 actually returned — it clamps a range that runs past the end. */
  range?: { offset?: number; length?: number; suffix?: number };
}

/** A parsed `Range` header. */
export type ParsedRange =
  | { kind: "range"; offset: number; length?: number }
  | { kind: "suffix"; suffix: number }
  /** Syntactically valid but unsatisfiable against this object → 416. */
  | { kind: "unsatisfiable" }
  /** Absent or unparseable → serve the whole object (per RFC 9110, an
   *  unparseable Range is ignored rather than rejected). */
  | null;

/**
 * Parse a `Range` header into something R2 understands.
 *
 * Handles the three forms that matter:
 *   `bytes=0-1023`   a bounded window
 *   `bytes=1024-`    open-ended, to the end
 *   `bytes=-20000`   the LAST n bytes — the one the reference dropped
 *
 * Multi-range (`bytes=0-99,200-299`) returns null: it requires a multipart
 * response no PMTiles client asks for, and serving the whole object is the
 * spec-legal fallback.
 */
export function parseRangeHeader(header: string | null, size: number): ParsedRange {
  if (!header) return null;
  const value = header.trim();
  if (!value.startsWith("bytes=")) return null;

  const spec = value.slice("bytes=".length).trim();
  if (spec.includes(",")) return null;

  const suffix = /^-(\d+)$/.exec(spec);
  if (suffix) {
    const n = Number(suffix[1]);
    // "last 0 bytes" is unsatisfiable per RFC 9110; a suffix larger than the
    // object legally means the whole object.
    if (n === 0) return { kind: "unsatisfiable" };
    return { kind: "suffix", suffix: Math.min(n, size) };
  }

  const bounded = /^(\d+)-(\d*)$/.exec(spec);
  if (!bounded) return null;

  const start = Number(bounded[1]);
  if (start >= size) return { kind: "unsatisfiable" };

  if (bounded[2] === "") return { kind: "range", offset: start };

  const end = Number(bounded[2]);
  if (end < start) return { kind: "unsatisfiable" };
  // An end past the object is clamped, not an error — a client asking for more
  // than exists gets what exists.
  return { kind: "range", offset: start, length: Math.min(end, size - 1) - start + 1 };
}

export interface PmtilesHandlerOptions {
  /** Reads the archive, whole or by range. See {@link RangeReader}. */
  read: RangeReader;
  /**
   * `Cache-Control` for the response. An archive is immutable — a re-clip
   * overwrites the object wholesale — so the byte ranges cache hard at the
   * edge. Default one day.
   */
  cacheControl?: string;
}

const CONTENT_TYPE = "application/octet-stream";

/**
 * Serve a PMTiles archive from R2 with range support.
 *
 * ```ts
 * export const GET: APIRoute = ({ request }) =>
 *   servePmtiles(request, {
 *     read: (range) => env.MEDIA.get(KEY, range ? { range } : undefined),
 *   });
 * ```
 *
 * A missing archive is a 404, not an error: the map module is usable before
 * anyone has uploaded a basemap (the canvas renders its background and pin),
 * which is the same dormant-until-provisioned posture as every other module.
 */
export async function servePmtiles(
  request: Request,
  options: PmtilesHandlerOptions,
): Promise<Response> {
  const { read, cacheControl = "public, max-age=86400" } = options;
  const headers = (extra: Record<string, string>) => ({
    "content-type": CONTENT_TYPE,
    "accept-ranges": "bytes",
    "cache-control": cacheControl,
    ...extra,
  });

  // HEAD is how a client discovers the length before ranging into the archive.
  const head = request.method === "HEAD";
  const rangeHeader = request.headers.get("range");

  // Without the size, an unsatisfiable range can't be told from a valid one, so
  // the object is fetched first when a range is present.
  const probe = rangeHeader ? await read() : null;
  if (rangeHeader && !probe) return new Response("Basemap not found", { status: 404 });

  const size = probe?.size ?? 0;
  const parsed = rangeHeader ? parseRangeHeader(rangeHeader, size) : null;

  if (parsed?.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      // RFC 9110: a 416 states the object's real length so the client can retry.
      headers: headers({ "content-range": `bytes */${size}` }),
    });
  }

  if (parsed) {
    const object = await read(
      parsed.kind === "suffix"
        ? { suffix: parsed.suffix }
        : { offset: parsed.offset, ...(parsed.length ? { length: parsed.length } : {}) },
    );
    if (!object) return new Response("Basemap not found", { status: 404 });

    // Trust what R2 says it returned rather than what was asked for — it clamps
    // ranges, and a Content-Range that disagrees with the body corrupts the
    // client's view of the archive.
    const got = object.range ?? {};
    const start =
      got.offset ?? (parsed.kind === "suffix" ? object.size - parsed.suffix : parsed.offset);
    const length = got.length ?? (got.suffix ?? object.size - start);
    return new Response(head ? null : (object.body ?? null), {
      status: 206,
      headers: headers({
        "content-range": `bytes ${start}-${start + length - 1}/${object.size}`,
        "content-length": String(length),
      }),
    });
  }

  const object = await read();
  if (!object) return new Response("Basemap not found", { status: 404 });
  return new Response(head ? null : (object.body ?? null), {
    headers: headers({ "content-length": String(object.size) }),
  });
}
