// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.

export {
  ASTROID_MAP_DEPENDENCIES,
  ASTROID_PMTILES_KEY,
  ASTROID_PMTILES_PATH,
  generateMapEmbedComponent,
  generateMapTileRoute,
  usesMap,
} from "./scaffold.js";
export {
  type ParsedRange,
  parseRangeHeader,
  type PmtilesHandlerOptions,
  type RangeObject,
  type RangeReader,
  type RangeSpec,
  servePmtiles,
} from "./pmtiles.js";
export { astroidMapStyle, type MapColors, type MapStyle, type MapStyleOptions } from "./style.js";
