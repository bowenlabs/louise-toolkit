// Vite/Rolldown `?raw` imports return the file's contents as a string. TypeScript
// doesn't know that on its own (there's no Vite `types` in this library package),
// so declare it: the icon set imports Phosphor SVGs this way (see `icons.tsx`),
// and the build inlines them.
declare module "*.svg?raw" {
  const content: string;
  export default content;
}

declare module "*?raw" {
  const content: string;
  export default content;
}
