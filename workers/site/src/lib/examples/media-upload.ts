// A media upload route on Cloudflare Workers, built on louise-toolkit/media. This is
// the real handler pattern a site's upload endpoint uses: verify the bytes, store
// to R2 under a scoped key, and hand back a resized derivative URL. It isn't
// mounted on this marketing site — a live upload needs an R2 bucket and would let
// anonymous visitors write to it — so /examples/media runs the same verification
// client-side against the file you drop, and stops before the `put`.
// The code below is sliced verbatim into that page's "upload.ts" tab.

// #region example:media-server
import { cfImage, mediaUrl, putMedia } from "louise-toolkit/media";

interface MediaEnv {
  MEDIA: R2Bucket; // the bucket uploads land in
  MEDIA_URL: string; // public base URL the bucket is served from
  IMAGES?: ImagesBinding; // optional — sizes AVIF/TIFF the header parser can't
}

// POST multipart/form-data with a `file` field — verify, store, return the URLs.
export async function handleUpload(request: Request, env: MediaEnv): Promise<Response> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });

  // The whole verification: bytes are sniffed for a real image signature, so a
  // file claiming `image/png` in its MIME but carrying JPEG bytes is stored as
  // what it actually is — or rejected outright. `putMedia` writes nothing when it
  // rejects: oversize is 413, non-image is 415.
  const result = await putMedia(env.MEDIA, file, { scope: "web", images: env.IMAGES });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  // The stored original, plus an on-the-fly resized derivative. `cfImage` only
  // rewrites the path to `/cdn-cgi/image/...` — nothing is re-encoded or stored
  // server-side, so a thumbnail costs no extra bytes in the bucket.
  const url = mediaUrl(env.MEDIA_URL, result.key);
  return Response.json({
    url,
    thumb: cfImage(url, { width: 480, fit: "cover", gravity: "auto", format: "auto" }),
    contentType: result.contentType, // the VERIFIED type, not the client's claim
    width: result.width,
    height: result.height,
  });
}
// #endregion example:media-server
