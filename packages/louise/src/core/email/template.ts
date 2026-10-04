// louise-toolkit/email—transactional email *templating* (the frame; sending lives in
// ./index). Built for email clients, not browsers: every colour is an inlined
// hex (no CSS variables / no <style> block), and the fragile bits—the page
// frame and the header colour band—are tables so Outlook's Word engine
// renders them.
//
// A site supplies a {@link MailTheme} (its palette, masthead, fonts, and a
// couple of layout tokens) and composes each email from these primitives:
// {@link renderEmailShell} (the frame), {@link mailButton}, {@link mailRows},
// and {@link mailFallbackLink}. Per-email COPY stays in the site—this module
// owns only the brand-agnostic structure the sites were duplicating.
//
// The card is fluid (`width:100%;max-width:600px`), so a phone shows the whole
// email instead of the left two-thirds of a fixed 600px table. Outlook's Word
// engine ignores `max-width`, so a conditional comment gives it a fixed table.

/** Semantic colour slots, flattened to hex for mail clients. A site maps its
 *  brand palette onto these; `accent` is the eyebrow + link colour, `onDark`
 *  the wordmark drawn over the colour band. */
export interface MailPalette {
  pageBg: string;
  bg: string;
  bgSoft: string;
  ink: string;
  inkSoft: string;
  inkMute: string;
  rule: string;
  ruleSoft: string;
  accent: string;
  onDark: string;
}

/** Font stacks (already client-safe strings, for example, `'Fraunces', Georgia, serif`). */
export interface MailFonts {
  serif: string;
  sans: string;
  mono: string;
}

/**
 * A logo image for the `"logo"` masthead. Mail clients don't render inline
 * SVG, and most block remote images until the reader allows them, so point
 * `src` at a PNG on a public host, export it at twice the displayed size, and
 * give the displayed size here. The alt text stands in while the image is
 * blocked, drawn like the wordmark: in `onDark`, in the serif font, at
 * `brandSize`.
 */
export interface MailLogo {
  /** Absolute `https:` URL of the image. Any other scheme falls back to the wordmark. */
  src: string;
  /** Alt text—plain text. Default the brand name. */
  alt?: string;
  /** Displayed width in CSS px. */
  width: number;
  /** Displayed height in CSS px. */
  height: number;
}

/** Everything brand-specific about a site's transactional mail. */
export interface MailTheme {
  palette: MailPalette;
  /** Header colour-band cells (rendered as equal-width columns). */
  band: string[];
  fonts: MailFonts;
  brand: {
    /** Wordmark drawn over the band, for example, `"Example Organization"`. */
    name: string;
    /** First footer line—tagline/location, for example, `"Example Organization · Open daily"`. */
    footerLead: string;
  };
  /**
   * The masthead. `"band"` (the default) draws the colour band with the
   * wordmark riding up into it. `"logo"` draws one solid band in `mastheadBg`
   * with the `logo` image, or the wordmark in `onDark`, centred, and centres
   * the footer to match. The headline and body stay left-aligned either way.
   */
  masthead?: "band" | "logo";
  /** The `"logo"` masthead's image. Without one, the wordmark is drawn. */
  logo?: MailLogo;
  /** The `"logo"` masthead's fill. Default the palette's `ink`. */
  mastheadBg?: string;
  /** Card corner radius in px. Default 6. */
  radius?: number;
  /**
   * Card drop shadow, for example, `"0 6px 20px rgba(0,0,0,0.08)"`. A card
   * with a shadow has no border; without one it has a 1px `rule` border.
   */
  shadow?: string;
  /** Colour-band height in px. Default 116. */
  bandHeight?: number;
  /** Wordmark font-size in px. Default 22. */
  brandSize?: number;
  /** Wordmark vertical overlap into the band (negative px). Default -46. */
  brandOffset?: number;
  /** Wordmark text-shadow. Default a soft dark shadow. */
  brandShadow?: string;
  /** Headline font-size in px. Default 32. */
  headlineSize?: number;
  /** Headline font-weight. Default 400. */
  headlineWeight?: number;
  /** Horizontal padding of the content column in px. Default 40. */
  contentPadding?: number;
  /** Default call-to-action button shape. Default "rounded". */
  buttonShape?: MailButtonShape;
  /** Default call-to-action button alignment. Default "left". */
  buttonAlign?: MailAlign;
}

/** A rendered transactional email (HTML + plain-text alternative + subject). */
export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

// ── escaping ────────────────────────────────────────────────────────────────

/** Escape a value for safe interpolation into HTML text/attributes. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The schemes a link in an email may use. A mail client can't follow a
 *  relative URL, and a `javascript:` or `data:` one has no business in mail. */
const MAIL_LINK_SCHEME = /^(?:https?:|mailto:)/i;

/**
 * The `href` attribute for a link in an email, escaped, or an empty string when
 * the URL's scheme isn't `https:`, `http:`, or `mailto:` (#703). An `<a>` with
 * no `href` renders its text and goes nowhere.
 */
function mailHref(url: string): string {
  const trimmed = url.trim();
  return MAIL_LINK_SCHEME.test(trimmed) ? ` href="${escapeHtml(trimmed)}"` : "";
}

/** An image `src`, escaped, or an empty string unless it's `https:` or `http:`. */
function mailSrc(url: string): string {
  const trimmed = url.trim();
  return /^https?:/i.test(trimmed) ? escapeHtml(trimmed) : "";
}

/** Escape user text and preserve its line breaks for an HTML email body. */
export function escapeMultiline(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

/** Collapse whitespace so a user value is safe in a `Subject:` header. */
export function subjectSafe(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ── building blocks ───────────────────────────────────────────────────────────

export type MailButtonShape = "pill" | "rounded";
export type MailAlign = "left" | "center";

export interface MailButtonOptions {
  href: string;
  /** Button label—trusted HTML (may include entities like `&rarr;`). */
  label: string;
  /** Override the theme's default shape for this button. */
  shape?: MailButtonShape;
  /** Override the theme's default alignment for this button. */
  align?: MailAlign;
}

/**
 * The primary call-to-action button. `pill` is a fully-rounded sans button;
 * `rounded` uses the card radius with a mono, wider-tracked label. Both sit on
 * the palette's `ink` fill.
 */
export function mailButton(theme: MailTheme, opts: MailButtonOptions): string {
  const { palette, fonts } = theme;
  const shape = opts.shape ?? theme.buttonShape ?? "rounded";
  const align = opts.align ?? theme.buttonAlign ?? "left";
  const href = mailHref(opts.href);
  const radius = shape === "pill" ? "999px" : `${theme.radius ?? 6}px`;
  const font = shape === "pill" ? fonts.sans : fonts.mono;
  const size = shape === "pill" ? "13px" : "11px";
  const tracking = shape === "pill" ? "0.1em" : "0.12em";
  const pad = shape === "pill" ? "15px 32px" : "16px 34px";
  // The `align` attribute centres the table in Outlook; the margin does it elsewhere.
  const centred = align === "center" ? ` align="center" style="margin:0 auto;"` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0"${centred}><tr><td style="border-radius:${radius};background:${palette.ink};">
<a${href} style="display:inline-block;padding:${pad};color:${palette.bg};font-family:${font};font-size:${size};letter-spacing:${tracking};text-transform:uppercase;text-decoration:none;border-radius:${radius};">${opts.label}</a>
</td></tr></table>`;
}

/** One line of a {@link mailRows} box. Both cells are trusted HTML. */
export interface MailRow {
  label: string;
  value: string;
}

/**
 * A soft box of label and value lines—an order's number and total, a request's
 * type and time. Labels sit left in the muted ink, values right in the ink,
 * bold. A table rather than flex, so Outlook keeps the two columns.
 */
export function mailRows(theme: MailTheme, rows: readonly MailRow[]): string {
  const { palette, fonts } = theme;
  const radius = Math.min(theme.radius ?? 6, 14);
  const cell = `font-family:${fonts.sans};font-size:14px;line-height:1.5;vertical-align:top;`;
  const lines = rows
    .map(
      (r) =>
        `<tr><td style="padding:5px 0;${cell}color:${palette.inkMute};">${r.label}</td><td align="right" style="padding:5px 0 5px 16px;${cell}color:${palette.ink};font-weight:600;text-align:right;">${r.value}</td></tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:${palette.bgSoft};border:1px solid ${palette.rule};border-radius:${radius}px;"><tr><td style="padding:12px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${lines}
</table>
</td></tr></table>`;
}

/**
 * The "button not working? paste this link" fallback block—a mono, wrapped,
 * copy-pasteable rendering of the same URL. Identical on every site, so it
 * lives here.
 */
export function mailFallbackLink(theme: MailTheme, url: string): string {
  const { palette, fonts } = theme;
  const href = mailHref(url);
  return `<div style="margin-top:32px;padding-top:24px;border-top:1px solid ${palette.ruleSoft};">
<p style="font-family:${fonts.mono};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${palette.inkMute};margin:0 0 10px;">Button not working? Paste this link</p>
<p style="font-family:${fonts.mono};font-size:12px;line-height:1.6;color:${palette.accent};word-break:break-all;margin:0;padding:12px 14px;background:${palette.bgSoft};border:1px solid ${palette.rule};border-radius:6px;"><a${href} style="color:${palette.accent};text-decoration:none;">${escapeHtml(url.trim())}</a></p>
</div>`;
}

// ── the frame ─────────────────────────────────────────────────────────────────

export interface EmailShellOptions {
  /** `<title>`—plain text. */
  title: string;
  /** Hidden inbox-preview text. Escape any user-supplied values before passing. */
  preheader: string;
  /** Small mono kicker above the headline—trusted HTML (may include entities). Empty omits it. */
  eyebrow: string;
  /** The headline, in the `serif` stack—trusted HTML. */
  headline: string;
  /** The email body—trusted HTML (compose with the helpers above). */
  bodyHtml: string;
  /** Second footer line—trusted HTML (escape user values first). */
  footerNote: string;
}

/**
 * Render the full transactional-email document around `opts.bodyHtml`: the
 * page frame, the masthead, the content column (eyebrow + headline + body),
 * and the two-line footer. Everything brand-specific comes from `theme`;
 * callers pass already-HTML-safe strings for the slots.
 */
export function renderEmailShell(theme: MailTheme, opts: EmailShellOptions): string {
  const { palette: p, fonts, brand } = theme;
  const radius = theme.radius ?? 6;
  const pad = theme.contentPadding ?? 40;
  const headlineSize = theme.headlineSize ?? 32;
  const headlineWeight = theme.headlineWeight ?? 400;
  const logoMasthead = theme.masthead === "logo";
  const edge = theme.shadow ? `box-shadow:${theme.shadow};` : `border:1px solid ${p.rule};`;
  const footerAlign = logoMasthead ? "center" : "left";
  const eyebrow = opts.eyebrow
    ? `<p style="font-family:${fonts.mono};font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${p.accent};margin:0 0 18px;">${opts.eyebrow}</p>\n`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:${p.pageBg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.pageBg};">
<tr><td align="center" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${p.bg};${edge}border-radius:${radius}px;overflow:hidden;">

${logoMasthead ? logoMastheadRow(theme, pad) : bandMastheadRow(theme, pad)}

<tr><td style="padding:40px ${pad}px 36px;">
${eyebrow}<h1 style="font-family:${fonts.serif};font-weight:${headlineWeight};font-size:${headlineSize}px;line-height:1.1;letter-spacing:-0.01em;color:${p.ink};margin:0 0 20px;">${opts.headline}</h1>
${opts.bodyHtml}
</td></tr>

<tr><td style="padding:24px ${pad}px 30px;background:${p.bgSoft};border-top:1px solid ${p.rule};text-align:${footerAlign};">
<p style="font-family:${fonts.mono};font-size:11px;line-height:1.6;letter-spacing:0.04em;color:${p.inkMute};margin:0 0 6px;">${brand.footerLead}</p>
<p style="font-family:${fonts.mono};font-size:11px;line-height:1.6;letter-spacing:0.04em;color:${p.inkMute};margin:0;">${opts.footerNote}</p>
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** The colour band with the wordmark riding up into it. */
function bandMastheadRow(theme: MailTheme, pad: number): string {
  const { palette: p, fonts, brand } = theme;
  const bandHeight = theme.bandHeight ?? 116;
  const brandSize = theme.brandSize ?? 22;
  const brandOffset = theme.brandOffset ?? -46;
  const brandShadow = theme.brandShadow ?? "0 1px 6px rgba(28,22,14,0.5)";
  const band = theme.band
    .map(
      (c) =>
        `<td width="${Math.round(100 / theme.band.length)}%" style="background:${c};height:${bandHeight}px;font-size:0;line-height:0;">&nbsp;</td>`,
    )
    .join("");
  return `<tr><td style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${band}</tr></table>
<div style="margin-top:${brandOffset}px;padding:0 ${pad}px 20px;position:relative;">
<span style="font-family:${fonts.serif};font-weight:400;font-size:${brandSize}px;color:${p.onDark};text-shadow:${brandShadow};">${brand.name}</span>
</div>
</td></tr>`;
}

/** One solid band with the logo image, or the wordmark, centred. */
function logoMastheadRow(theme: MailTheme, pad: number): string {
  const { palette: p, fonts, brand } = theme;
  const bg = theme.mastheadBg ?? p.ink;
  const src = theme.logo ? mailSrc(theme.logo.src) : "";
  // A client that blocks the image draws its alt text with the image's own
  // font and color, or the cell's, so both carry the wordmark's type in
  // `onDark`. Without them, the alt text inherits `ink` on an `ink` band.
  const type = `font-family:${fonts.serif};font-weight:400;font-size:${theme.brandSize ?? 22}px;line-height:1.2;color:${p.onDark};`;
  const mark =
    theme.logo && src
      ? `<img src="${src}" alt="${escapeHtml(theme.logo.alt ?? brand.name)}" width="${theme.logo.width}" height="${theme.logo.height}" style="display:block;margin:0 auto;width:${theme.logo.width}px;height:${theme.logo.height}px;border:0;${type}">`
      : `<span style="${type}">${brand.name}</span>`;
  return `<tr><td align="center" style="padding:22px ${pad}px;background:${bg};text-align:center;color:${p.onDark};">
${mark}
</td></tr>`;
}
