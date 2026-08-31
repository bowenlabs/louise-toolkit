---
title: qr
description: "louise-toolkit/qr—a vendored, zero-dependency QR encoder and SVG renderer, for scan-to-pay links and anything else printable."
sidebar:
  order: 15.5
---

```ts
import { encodeQr, qrSvg, qrDataUri } from "louise-toolkit/qr";
```

An ISO/IEC 18004 QR encoder and SVG renderer. No bindings, no DOM, no I/O, no
dependencies—so a QR route renders identically at build time, in a Worker, and
in a unit test.

## Usage

```ts
const svg = qrSvg("https://shop.example/pay/abc123", {
  ecc: "M",
  title: "Scan to pay",
  size: 512,
});
```

|                          |                                                                 |
| ------------------------ | --------------------------------------------------------------- |
| `encodeQr(data, opts?)`  | → `QrMatrix`—the raw module grid, if you're drawing it yourself |
| `qrSvg(data, opts?)`     | → a standalone SVG document string                              |
| `qrDataUri(data, opts?)` | → the same SVG as a `data:` URI, for an `<img src>`             |

Four options are worth knowing about, because each default encodes a decision:

- **`margin`** is in **modules, not pixels**—default 4, the spec minimum. Less
  than that and real scanners start failing against a busy shop wall. It is the
  option most likely to be "tidied" into a smaller number by someone treating it
  as CSS padding.
- **`light`** defaults to opaque white rather than transparent, so a code printed
  onto coloured stock still scans. Pass `null` when you genuinely want the
  background to show through.
- **`size`** emits `width`/`height` alongside the `viewBox`. Set it for a
  downloadable file; **omit** it for an inline SVG that should scale with its
  container.
- **`title`** renders as `<title>`, giving an inline code an accessible name.

`encodeQr` picks the smallest version that fits, keeping the code as coarse—and
so as scannable from a distance or an angle—as the payload allows. It throws
only when the data exceeds version 40 at the chosen ECC, roughly 1.2 KB even at
`H`, which no URL will reach.

**Byte mode only, deliberately.** Everything this encodes is a URL, and URLs are
mixed-case, so alphanumeric mode can never apply and numeric/kanji would be dead
code.

## Getting a PNG

There is no PNG function here, and nothing QR-specific is needed for one. Hand
`qrSvg()` to the SVG→PNG rasterizer in [`browser`](/reference/browser/):

```ts
const render = createResvgRenderer({ wasm, fonts: [] });
const png = await render(qrSvg(url));
```

A QR code is pure geometry with no text nodes, so it needs no font loaded—unlike
an OG card, where an empty `fonts` array renders a blank background.

## With Square payment links

`createPaymentLink` ([`commerce/square`](/reference/commerce/)) returns a
`PaymentLink` with a `url`. **Square does not return a QR code**—the object has
no image field. You generate one from `url`, which is exactly what this module is
for:

```ts
const link = await createPaymentLink(config, {
  locationId,
  quickPay: { name: "Print", priceMoney },
});
const svg = qrSvg(link.url, { title: "Scan to pay" });
```

## Why it's vendored

`louise-toolkit` ships zero runtime dependencies, and the obvious candidates each
cost more than they save: `qrcode` drags in pngjs plus Node `Buffer`/`fs`
assumptions that don't hold in a Worker, and `qrcode-svg` is unmaintained
CommonJS.

QR is also a frozen spec—18004 hasn't moved meaningfully since 2006—so this is
one of the few places where vendoring carries no upgrade treadmill and no
supply-chain surface. Same argument the codebase already makes for
`core/browser/og-card.ts` and `core/media/dimensions.ts`.

## Types

`QrMatrix` (`{ size, modules, version, ecc, mask }`), `QrErrorCorrection`
(`"L" | "M" | "Q" | "H"`), `QrSvgOptions`.
