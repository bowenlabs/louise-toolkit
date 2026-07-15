// Phosphor icons for the marketing landing, inlined raw from @phosphor-icons/core
// so they render as SVG that inherits `currentColor` — no icon font, no runtime
// fetch (the site convention). `bold` weight for UI glyphs, `fill` for the
// lightning accents, matching the design mock. Rendered via Icon.astro.
import article from "@phosphor-icons/core/assets/bold/article-bold.svg?raw";
import database from "@phosphor-icons/core/assets/bold/database-bold.svg?raw";
import envelope from "@phosphor-icons/core/assets/bold/envelope-bold.svg?raw";
import image from "@phosphor-icons/core/assets/bold/image-bold.svg?raw";
import lightningBold from "@phosphor-icons/core/assets/bold/lightning-bold.svg?raw";
import lockKey from "@phosphor-icons/core/assets/bold/lock-key-bold.svg?raw";
import pencilSimple from "@phosphor-icons/core/assets/bold/pencil-simple-bold.svg?raw";
import queue from "@phosphor-icons/core/assets/bold/queue-bold.svg?raw";
import shoppingCart from "@phosphor-icons/core/assets/bold/shopping-cart-bold.svg?raw";
import textbox from "@phosphor-icons/core/assets/bold/textbox-bold.svg?raw";
import lightningFill from "@phosphor-icons/core/assets/fill/lightning-fill.svg?raw";

export const lightningFillSvg = lightningFill;
export const pencilSvg = pencilSimple;

// Feature-grid glyphs, keyed by the `icon` token stored per primitive
// (defaults seeded to match the design). Unknown tokens fall back to lightning.
export const FEATURE_ICONS: Record<string, string> = {
  "ph-article": article,
  "ph-database": database,
  "ph-image": image,
  "ph-textbox": textbox,
  "ph-shopping-cart": shoppingCart,
  "ph-envelope": envelope,
  "ph-queue": queue,
  "ph-lock-key": lockKey,
  "ph-lightning": lightningBold,
};

export function featureIcon(token: string | undefined): string {
  return (token && FEATURE_ICONS[token]) || lightningBold;
}
