// Runs before every client test, under either happy-dom environment (the
// custom one in ../happy-dom-env.ts, or the builtin one a file picks with its
// `@vitest-environment` docblock).
//
// happy-dom has no Web Animations API. ProseKit's inline popover popup, which
// the format bubble renders (#761), calls `getAnimations()` on its host to wait
// for an exit animation before it hides; with none, an empty list hides it at
// once, which is what a browser without an animation does too.
const proto = (globalThis as unknown as { Element?: { prototype: Record<string, unknown> } })
  .Element?.prototype;
if (proto && typeof proto.getAnimations !== "function") {
  proto.getAnimations = () => [];
}
