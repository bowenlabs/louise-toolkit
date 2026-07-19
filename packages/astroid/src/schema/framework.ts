// Copyright (c) 2026 BowenLabs. Astroid is MIT licensed.
//
// Which ready-made Louise tables (louise-toolkit/db) an Astroid project needs.
// Astroid re-exports these rather than redefining them, so the core content
// tables never drift from Louise. `media` and `siteSettings` are universal;
// `inquiries` is pulled in only when a brand actually captures inquiries (a
// contact section, or a wholesale-inquiry module).

import type { AstroidConfig } from "../config.js";

/** A ready-made table Astroid re-exports from `louise-toolkit/db`. */
export type AstroidFrameworkTable = "inquiries" | "media" | "siteSettings";

/** True when the site captures inquiries — a contact section or a
 *  wholesale-inquiry module. Shared by table selection (here) and route selection
 *  (the worker route plan). */
export function capturesInquiries(config: AstroidConfig): boolean {
  const wantsWholesale = (mods?: readonly string[]) => (mods ?? []).includes("wholesaleInquiry");
  return (
    (config.sections ?? []).includes("contact") ||
    wantsWholesale(config.modules) ||
    wantsWholesale(config.portal?.features)
  );
}

/**
 * The framework tables this project needs, sorted alphabetically (so the emitted
 * import/export lists are stable). `media` + `siteSettings` always; `inquiries`
 * when a brand captures them.
 */
export function astroidFrameworkTables(config: AstroidConfig): AstroidFrameworkTable[] {
  const tables: AstroidFrameworkTable[] = ["media", "siteSettings"];
  if (capturesInquiries(config)) tables.push("inquiries");
  return tables.sort();
}
