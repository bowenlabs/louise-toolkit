// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.

export {
  catalogNormalizer,
  type FourthwallProductLike,
  fourthwallToCatalogItem,
  type SquareItemLike,
  squareToCatalogItem,
} from "./adapters.js";
export {
  type CheckoutVerification,
  checkoutIdempotencyKey,
  type ClientLine,
  type PriceLookup,
  verifyCheckout,
  type VerifiedLine,
} from "./checkout.js";
export {
  astroidCatalogLoaderConfig,
  type CatalogDatabase,
  type CatalogProduct,
  type CatalogReadOptions,
  readCatalog,
  readCatalogItem,
} from "./loader.js";
export {
  astroidCatalogMirror,
  BUILT_IN_OWNED,
  type CatalogMirrorConfig,
  generateCatalogTable,
  type OwnedColumn,
  PULLED_COLUMNS,
} from "./mirror.js";
export {
  COMMERCE_PROVIDER_SECRETS,
  type CommerceStatus,
  commerceSecretNames,
  type ProviderStatus,
  resolveCommerceStatus,
} from "./secrets.js";
export {
  assertCommerceRoles,
  astroidCommerceProviders,
  astroidCommerceRoles,
  type CommerceRole,
  hasStorefront,
  PROVIDER_ROLES,
  type ResolvedCommerceRoles,
} from "./roles.js";
export {
  astroidCatalogSync,
  astroidCatalogUpsert,
  type CatalogItem,
  type CatalogSyncOptions,
  type CatalogSyncResult,
  defaultSlug,
  type SyncDatabase,
} from "./sync.js";
