// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// What a routed studio needs from navigation, with no router in sight: where it
// is mounted, what each screen is called, and where focus goes when the screen
// changes. `louise-toolkit/client/studio-shell` wires these to TanStack Router;
// a site on any other router calls them from its own navigation hook.
//
// ── Why the basepath is computed, not configured ─────────────────────────────
//
// A studio is commonly served two ways at once: under a path on the main host
// (`example.com/studio/orders`) and at the root of its own subdomain
// (`studio.example.com/orders`, where a host rewrite adds the prefix on the
// server). The browser sees different paths for the same screen, so the router's
// basepath can only be decided in the browser, from the URL it actually loaded.
// Hard-code either one and the other host's deep links return a 404.

/** One entry in a studio's navigation: the route path and what it's called. */
export interface StudioNavItem {
  /** Root-relative route path, as the router sees it (`"/"`, `"/orders"`). */
  to: string;
  /** What the screen is called—the nav label and the document title. */
  label: string;
}

/** Whether `pathname` is `prefix` itself or somewhere under it. */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** `prefix` normalized to a leading slash and no trailing one (`"studio/"` → `"/studio"`). */
function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+|\/+$/g, "");
  if (!trimmed) throw new RangeError('studio prefix must name a path segment, such as "/studio"');
  return `/${trimmed}`;
}

/**
 * The router basepath for a studio mounted under `prefix` on one host and at
 * the root of another: `prefix` when the page was loaded under it, else `"/"`.
 *
 * Matches whole segments, so a `/studios` page is not mistaken for the studio.
 */
export function studioBasepath(prefix: string, pathname: string = location.pathname): string {
  const p = normalizePrefix(prefix);
  return isUnder(pathname, p) ? p : "/";
}

/**
 * A link to a server-rendered page that lives beside the studio's routes but
 * outside the router (a printable document, an export download), resolved for
 * whichever host the studio was loaded on:
 *
 *   studio under /studio  → `/studio/print/labels`
 *   studio at the root    → `/print/labels`
 *
 * A hard-coded `/studio/print/labels` on the root host resolves through the
 * host rewrite to `/studio/studio/print/labels`, which is a 404. Read at call time,
 * so a link rendered before navigation settles is still right.
 */
export function studioHref(
  prefix: string,
  path: string,
  pathname: string = location.pathname,
): string {
  const base = studioBasepath(prefix, pathname);
  const rest = path.replace(/^\/+/, "");
  return base === "/" ? `/${rest}` : `${base}/${rest}`;
}

/**
 * The nav entry a route path falls under—the longest matching `to`, by whole
 * segments, so `/orders/42` is "Orders" and `/` matches only itself. `null`
 * when nothing matches.
 */
export function activeNavItem<T extends StudioNavItem>(
  nav: readonly T[],
  pathname: string,
): T | null {
  let best: T | null = null;
  for (const item of nav) {
    const hit = item.to === "/" ? pathname === "/" : isUnder(pathname, item.to.replace(/\/+$/, ""));
    if (hit && (!best || item.to.length > best.to.length)) best = item;
  }
  return best;
}

/** How {@link screenTitle} words a title. */
export interface ScreenTitleOptions {
  /** Appended after the screen's label, for example the site or app name. Omitted, no suffix. */
  suffix?: string;
  /** The title when no nav entry matches. Default: the suffix alone, else `"Studio"`. */
  fallback?: string;
  /** Between label and suffix. Default: an em dash with a space on each side. */
  separator?: string;
}

/**
 * A document title for the screen at `pathname`: the screen's label, then the
 * suffix. Each browser tab, history entry and screen-reader page announcement
 * then says where it is, rather than every screen being called the same thing.
 */
export function screenTitle(
  nav: readonly StudioNavItem[],
  pathname: string,
  options: ScreenTitleOptions = {},
): string {
  const label = activeNavItem(nav, pathname)?.label;
  const { suffix, separator = " — " } = options;
  if (!label) return options.fallback ?? suffix ?? "Studio";
  return suffix ? `${label}${separator}${suffix}` : label;
}

/**
 * Move focus to the new screen's heading, so a screen-reader user hears where
 * a navigation landed instead of the content changing silently while focus
 * stays on the nav link they pressed. Call it after a client-side navigation,
 * NOT on first load: the page itself already arrived then, and stealing focus
 * would skip the user past the navigation.
 *
 * Waits a frame for the new screen to render. The heading is made focusable
 * with `tabindex="-1"` (reachable by script, not by Tab) and focused without
 * scrolling. Returns a cancel function for a navigation that's superseded
 * before the frame.
 */
export function focusScreenHeading(
  container: HTMLElement | null | undefined,
  selector = "h1",
): () => void {
  const frame = requestAnimationFrame(() => {
    const heading = container?.querySelector<HTMLElement>(selector);
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
  return () => cancelAnimationFrame(frame);
}

/**
 * Scroll the active nav link into view when the nav is a sideways-scrolling
 * row (the usual phone layout), so a deep link to the last screen doesn't show
 * the first few links and no sign of where you are. Does nothing when the row
 * isn't overflowing.
 */
export function revealActiveNavLink(
  nav: HTMLElement | null | undefined,
  activeSelector = '[aria-current="page"]',
): void {
  if (!nav || nav.scrollWidth <= nav.clientWidth) return;
  nav.querySelector<HTMLElement>(activeSelector)?.scrollIntoView({
    inline: "center",
    block: "nearest",
  });
}
