// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/client/studio-shell`—a routed studio's frame, on TanStack
// Router (ADR 0011: adopted after the #317 island spike; an optional peer, so a
// site without a routed studio never installs it).
//
// The frame is the part every routed studio rebuilt by hand, and the part an
// accessibility audit found missing each time: a document title per screen, a
// skip link, and focus moved to the new screen's heading after a navigation, so
// a screen-reader user hears where they landed. The behaviour itself lives in
// `client/studio` (router-agnostic); this file only connects it to the router.
//
// What stays the site's: the route tree, the screens, the router instance and
// its type registration, and the look. The frame renders plain elements with
// `louise-studio-shell*` classes and no visual opinion beyond keeping the skip
// link hidden until it's focused.
//
// Wiring, in a `client:only` island:
//
//   const rootRoute = createRootRoute({
//     component: () => <StudioShell nav={NAV} brand="Studio" title={{ suffix: "Studio" }} />,
//   });
//   const router = createRouter({ routeTree, basepath: studioBasepath("/studio") });

import { Link, Outlet, useLocation } from "@tanstack/solid-router";
import { createEffect, For, type JSX, on, onCleanup, onMount, Suspense } from "solid-js";
import {
  focusScreenHeading,
  revealActiveNavLink,
  type ScreenTitleOptions,
  type StudioNavItem,
  screenTitle,
} from "../studio/navigation.js";

export interface StudioShellProps {
  /** The screens, in nav order. `to` is root-relative, as the router sees it. */
  nav: readonly StudioNavItem[];
  /** Header content before the nav—a name or a logo. Omitted, no brand. */
  brand?: JSX.Element;
  /** How each screen's document title is worded. */
  title?: ScreenTitleOptions;
  /** The nav's accessible name. Default `"Studio"`. */
  navLabel?: string;
  /** The skip link's text. Default `"Skip to content"`. */
  skipLabel?: string;
  /** What focus moves to after a navigation. Default the screen's `h1`. */
  headingSelector?: string;
  /** The screen. Default the router's `<Outlet />`. */
  children?: JSX.Element;
}

/** The main region's id—the skip link's target. One shell per page. */
const MAIN_ID = "louise-studio-main";

/** Hidden until focused, then pinned top-left above everything: the one piece
 *  of styling the frame can't leave to the site, because a skip link that is
 *  always visible or never visible has failed either way. */
const SKIP_LINK_CSS = `.louise-studio-shell-skip{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
.louise-studio-shell-skip:focus{position:fixed;left:1rem;top:1rem;width:auto;height:auto;overflow:visible;z-index:2147483647;padding:.5rem .75rem;background:#fff;color:#111;border-radius:.375rem;box-shadow:0 0 0 2px currentColor}`;

function injectSkipLinkStyle(): void {
  if (document.getElementById("louise-studio-shell-style")) return;
  const style = document.createElement("style");
  style.id = "louise-studio-shell-style";
  style.textContent = SKIP_LINK_CSS;
  document.head.appendChild(style);
}

/** A routed studio's frame: skip link, header + nav, and the screen. */
export function StudioShell(props: StudioShellProps): JSX.Element {
  let nav: HTMLElement | undefined;
  let main: HTMLElement | undefined;
  const location = useLocation();

  injectSkipLinkStyle();

  // Every screen titled alike tells nobody anything—not the tab strip, not
  // history, not a screen reader announcing the page.
  createEffect(
    on(
      () => location().pathname,
      (pathname) => {
        document.title = screenTitle(props.nav, pathname, props.title);
      },
    ),
  );

  // After a navigation, not on first load (`defer`): the first screen arrived
  // with the page, and taking focus then would skip the user past the nav.
  createEffect(
    on(
      () => location().pathname,
      () => onCleanup(focusScreenHeading(main, props.headingSelector)),
      { defer: true },
    ),
  );

  // A deep link to the last screen on a phone, where the nav scrolls sideways,
  // otherwise shows the first few links and no sign of where you are. The
  // active link is marked after the first route match, hence the frame.
  onMount(() => {
    const frame = requestAnimationFrame(() => revealActiveNavLink(nav));
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const skip = (e: MouseEvent) => {
    // Focus the region directly rather than following `#…`, which would push a
    // history entry through the router for what is only a focus move.
    e.preventDefault();
    main?.focus();
  };

  return (
    <div class="louise-studio-shell">
      <a class="louise-studio-shell-skip" href={`#${MAIN_ID}`} onClick={skip}>
        {props.skipLabel ?? "Skip to content"}
      </a>
      <header class="louise-studio-shell-bar">
        {props.brand}
        <nav
          class="louise-studio-shell-nav"
          aria-label={props.navLabel ?? "Studio"}
          ref={(el) => (nav = el)}
        >
          <For each={props.nav}>
            {(item) => (
              <Link to={item.to} activeOptions={{ exact: item.to === "/" }}>
                {item.label}
              </Link>
            )}
          </For>
        </nav>
      </header>
      <main class="louise-studio-shell-main" id={MAIN_ID} tabIndex={-1} ref={(el) => (main = el)}>
        <Suspense>{props.children ?? <Outlet />}</Suspense>
      </main>
    </div>
  );
}
