// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// Multi-file upload to the framework media route, reporting every file's
// outcome. Shared by the Media panel and any studio form that uploads.

export interface UploadOutcome {
  uploaded: { file: File; url: string }[];
  /** One entry per file that didn't make it, with the server's reason. */
  failed: { file: File; error: string }[];
}

/**
 * Upload `files` one at a time to the media route and report each outcome.
 *
 * Every failure is kept. A loop that set a single error message on each failure
 * showed only the LAST one: pick five images, have two refused, and you were told
 * about one of them — or, if the last file succeeded, none. The form then showed
 * fewer images than were picked, with nothing to say why.
 *
 * `onUploaded` fires as each file lands, so a form can add images as they
 * arrive rather than after the whole batch.
 */
export async function uploadMediaFiles(
  files: readonly File[],
  options: { endpoint?: string; onUploaded?: (url: string, file: File) => void } = {},
): Promise<UploadOutcome> {
  const endpoint = options.endpoint ?? "/api/louise/media";
  const outcome: UploadOutcome = { uploaded: [], failed: [] };
  for (const file of files) {
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(endpoint, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        outcome.uploaded.push({ file, url: data.url });
        options.onUploaded?.(data.url, file);
      } else {
        outcome.failed.push({ file, error: data.error || `Upload failed (${res.status})` });
      }
    } catch (err) {
      outcome.failed.push({ file, error: err instanceof Error ? err.message : "Upload failed" });
    }
  }
  return outcome;
}

/** One line naming every file that failed and why — for an alert. `null` when none did. */
export function describeUploadFailures(outcome: UploadOutcome): string | null {
  const { failed, uploaded } = outcome;
  if (failed.length === 0) return null;
  const total = failed.length + uploaded.length;
  const list = failed.map((f) => `${f.file.name} (${f.error})`).join("; ");
  return total === 1
    ? `Couldn’t upload ${list}.`
    : `${failed.length} of ${total} didn’t upload: ${list}.`;
}
