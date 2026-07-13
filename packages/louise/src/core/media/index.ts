// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise/media
//
// A site's media library: verified R2 uploads (magic-byte sniffed), paged
// listing, delete-with-reference-scan, and Cloudflare Image-Resizing URL
// transforms + a per-usage CSS crop. The `media` table these track lives in
// `louise/db` (`mediaColumns` / `media`). Bindings contract: `MEDIA` (R2) +
// `MEDIA_URL` — see {@link LouiseMediaEnv}.

export { type ImageDimensions, imageDimensions } from "./dimensions.js";
export { sniffImageType, type SniffedImageType } from "./sniff.js";
export {
  DEFAULT_MAX_BYTES,
  deleteMedia,
  findMediaReferences,
  isMediaUrl,
  likePattern,
  listMedia,
  type MediaItem,
  type MediaMeta,
  type MediaReference,
  type MediaRefSource,
  mediaMetaByUrl,
  mediaUrl,
  putMedia,
  type PutMediaOptions,
  type PutMediaResult,
} from "./storage.js";
export {
  cfImage,
  type CfImageOptions,
  cfImageSrcset,
  type CfImageSrcsetOptions,
  circleImage,
  type Crop,
  cropStyle,
} from "./transform.js";
export type { LouiseMediaEnv } from "./types.js";
