// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/forms—whether a honeypot's name invites autofill (#590). A
// browser or password manager fills fields by name, and a decoy it fills holds
// a real visitor's message as spam. `defineForm` warns about such a name.

/** Words in a field name that browsers and password managers match to fill it. */
const AUTOFILL_WORDS = new Set([
  "name",
  "given",
  "family",
  "first",
  "last",
  "nickname",
  "username",
  "user",
  "login",
  "email",
  "mail",
  "tel",
  "phone",
  "mobile",
  "fax",
  "url",
  "website",
  "web",
  "homepage",
  "site",
  "company",
  "organization",
  "org",
  "address",
  "street",
  "city",
  "town",
  "zip",
  "postal",
  "postcode",
  "state",
  "region",
  "province",
  "country",
  "bday",
  "birthday",
  "password",
  "cc",
  "card",
]);

/**
 * Whether autofill is likely to fill a field with this name: the name, split
 * into words on punctuation and camelCase, contains a word that browsers or
 * password managers match (`website`, `email`, `company`, `address`, …). A
 * honeypot with such a name catches real visitors whose browser fills it.
 */
export function autofillProneName(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => AUTOFILL_WORDS.has(word.replace(/\d+$/, "")));
}
