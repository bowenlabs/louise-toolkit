// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.

import type { LouiseEnv } from "../security/index.js";

/**
 * Bindings the Louise media primitives read off a Worker's `env`. A site whose
 * `Env` handles media should `extends LouiseMediaEnv`. Widens the security base
 * (`LouiseEnv`) with the R2 bucket and its public base URL. The helpers in
 * `./storage` take the bucket explicitly, so this interface is the typed
 * bindings *contract* — not something the functions reach for implicitly.
 */
export interface LouiseMediaEnv extends LouiseEnv {
  /** R2 bucket holding uploaded assets. */
  MEDIA: R2Bucket;
  /** Public base URL the bucket is served from (e.g. `https://media.example.com`).
   *  The public URL of an object is `MEDIA_URL` + "/" + its key. */
  MEDIA_URL: string;
}
