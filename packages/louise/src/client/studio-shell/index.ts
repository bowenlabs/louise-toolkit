// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// `louise-toolkit/client/studio-shell`—a routed studio's frame on TanStack
// Router. Its own subpath because `@tanstack/solid-router` is an optional peer:
// only a site that imports this installs it. The router-agnostic pieces are
// re-exported so a routed studio needs one import.

export { StudioShell, type StudioShellProps } from "./shell.jsx";
export {
  activeNavItem,
  focusScreenHeading,
  revealActiveNavLink,
  type ScreenTitleOptions,
  screenTitle,
  studioBasepath,
  studioHref,
  type StudioNavItem,
} from "../studio/navigation.js";
