// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// Standard Louise user name fields. Generated on every getLouiseAuth site (and
// merged ahead of a site's own `additionalFields`) so the Users panel + the
// `editorsRoute` can always rely on first/last name being present. Defined once
// here and consumed by BOTH the runtime factory (auth.ts) and the schema
// generator (schema-gen.ts) so the two can never drift ("always generate,
// never hand-roll").
//
// Both are optional/nullable text columns — additive, so bringing an existing
// site onto a louise version that includes them is a safe migration.
export const LOUISE_USER_FIELDS = {
  firstName: { type: "string", required: false, input: true },
  lastName: { type: "string", required: false, input: true },
} as const;
