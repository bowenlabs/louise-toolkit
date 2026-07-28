// Cross-mount editor signals.
//
// The editor is not one component tree: `mountLouise` (the edit bar), `mountSections`
// (the on-canvas surface) and `mountSettings` (the drawer) mount independently, in
// any order, and a host may mount only some of them. Where one has to reach another
// they do it through window events keyed by the constants here.
//
// These live in their own module rather than beside their consumers so that, e.g.,
// the sections surface can listen for a Settings signal without importing the
// settings shell — which would pull the whole drawer bundle in behind it.

/** Fired by the drawer's History icon to open the sections **version-history
 *  drawer** (coracle.coffee#36). History is deliberately NOT a Settings panel:
 *  versions are per-PAGE and the sections surface mounts independently of
 *  `mountSettings`, so the drawer stays on the sections side and only the trigger
 *  moved into Settings. */
export const OPEN_HISTORY_EVENT = "louise:open-history";

/** Fired by `mountSettings` so an already-mounted sections surface can drop its own
 *  fallback History button. The two mount in either order — a sections surface that
 *  mounts second instead detects `#louise-drawer-root` directly. */
export const SETTINGS_READY_EVENT = "louise:settings-ready";

/** Set on `<html>` by a mounted sections surface to advertise that a version-history
 *  drawer exists to open. Without it the drawer's History icon would be a dead
 *  button on hosts that mount Settings but no sections surface. */
export const HISTORY_READY_ATTR = "data-louise-history";
