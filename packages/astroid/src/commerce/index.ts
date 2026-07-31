// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.

export {
  catalogNormalizer,
  type FourthwallProductLike,
  fourthwallToCatalogItem,
  type SquareAdapterOptions,
  squareItemSoldAt,
  type SquareItemLike,
  type SquareLocationOverrideLike,
  type SquarePresenceLike,
  squareToCatalogItem,
} from "./adapters.js";
export {
  type CheckoutRefusal,
  type CheckoutScope,
  type CheckoutVerification,
  checkoutIdempotencyKey,
  type ClientLine,
  type PriceLookup,
  type ScopedPriceLookup,
  type ScopedPrices,
  verifyCheckout,
  type VerifiedLine,
  type VerifyCheckoutOptions,
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
  generateCatalogMigrationSql,
  generateCatalogTable,
  type OwnedColumn,
  PULLED_COLUMNS,
} from "./mirror.js";
export {
  COMMERCE_PROVIDER_SECRETS,
  type CommerceStatus,
  commerceSecretNames,
  type ProviderStatus,
  providerConfigured,
  resolveCommerceStatus,
  roleConfigured,
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
export {
  astroidCheckoutVars,
  generateAstroidCheckoutEnv,
  generateAstroidCheckoutRoute,
  generateAstroidSquareCard,
  usesCardCheckout,
} from "./checkout-scaffold.js";
