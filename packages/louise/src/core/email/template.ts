// louise/email — transactional email *templating* (the frame; sending lives in
// ./index). Built for email clients, not browsers: every colour is an inlined
// hex (no CSS variables / no <style> block), and the fragile bits — the page
// frame and the header colour band — are tables so Outlook's Word engine
// renders them.
//
// A site supplies a {@link MailTheme} (its palette, colour band, fonts, and a
// couple of layout tokens) and composes each email from these primitives:
// {@link renderEmailShell} (the frame), {@link mailButton}, and
// {@link mailFallbackLink}. Per-email COPY stays in the site — this module owns
// only the brand-agnostic structure both louise sites were duplicating.

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

/** Font stacks (already client-safe strings, e.g. `'Fraunces', Georgia, serif`). */
export interface MailFonts {
  serif: string;
  sans: string;
  mono: string;
}

/** Everything brand-specific about a site's transactional mail. */
export interface MailTheme {
  palette: MailPalette;
  /** Header colour-band cells (rendered as equal-width columns). */
  band: string[];
  fonts: MailFonts;
  brand: {
    /** Wordmark drawn over the band, e.g. `"Coracle Coffee"`. */
    name: string;
    /** First footer line — tagline/location, e.g. `"Coracle Coffee · on the water"`. */
    footerLead: string;
  };
  /** Card corner radius in px. Default 6. */
  radius?: number;
  /** Colour-band height in px. Default 116. */
  bandHeight?: number;
  /** Wordmark font-size in px. Default 22. */
  brandSize?: number;
  /** Wordmark vertical overlap into the band (negative px). Default -46. */
  brandOffset?: number;
  /** Wordmark text-shadow. Default a soft dark shadow. */
  brandShadow?: string;
  /** Default call-to-action button shape. Default "rounded". */
  buttonShape?: MailButtonShape;
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
    .replace(/"/g, "&quot;");
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

export interface MailButtonOptions {
  href: string;
  /** Button label — trusted HTML (may include entities like `&rarr;`). */
  label: string;
  /** Override the theme's default shape for this button. */
  shape?: MailButtonShape;
}

/**
 * The primary call-to-action button. `pill` is a fully-rounded sans button;
 * `rounded` uses the card radius with a mono, wider-tracked label. Both sit on
 * the palette's `ink` fill.
 */
export function mailButton(theme: MailTheme, opts: MailButtonOptions): string {
  const { palette, fonts } = theme;
  const shape = opts.shape ?? theme.buttonShape ?? "rounded";
  const href = escapeHtml(opts.href);
  const radius = shape === "pill" ? "999px" : `${theme.radius ?? 6}px`;
  const font = shape === "pill" ? fonts.sans : fonts.mono;
  const size = shape === "pill" ? "13px" : "11px";
  const tracking = shape === "pill" ? "0.1em" : "0.12em";
  const pad = shape === "pill" ? "15px 32px" : "16px 34px";
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:${radius};background:${palette.ink};">
<a href="${href}" style="display:inline-block;padding:${pad};color:${palette.bg};font-family:${font};font-size:${size};letter-spacing:${tracking};text-transform:uppercase;text-decoration:none;border-radius:${radius};">${opts.label}</a>
</td></tr></table>`;
}

/**
 * The "button not working? paste this link" fallback block — a mono, wrapped,
 * copy-pasteable rendering of the same URL. Identical on every site, so it
 * lives here.
 */
export function mailFallbackLink(theme: MailTheme, url: string): string {
  const { palette, fonts } = theme;
  const href = escapeHtml(url);
  return `<div style="margin-top:32px;padding-top:24px;border-top:1px solid ${palette.ruleSoft};">
<p style="font-family:${fonts.mono};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${palette.inkMute};margin:0 0 10px;">Button not working? Paste this link</p>
<p style="font-family:${fonts.mono};font-size:12px;line-height:1.6;color:${palette.accent};word-break:break-all;margin:0;padding:12px 14px;background:${palette.bgSoft};border:1px solid ${palette.rule};border-radius:6px;"><a href="${href}" style="color:${palette.accent};text-decoration:none;">${href}</a></p>
</div>`;
}

// ── the frame ─────────────────────────────────────────────────────────────────

export interface EmailShellOptions {
  /** `<title>` — plain text. */
  title: string;
  /** Hidden inbox-preview text. Escape any user-supplied values before passing. */
  preheader: string;
  /** Small mono kicker above the headline — trusted HTML (may include entities). */
  eyebrow: string;
  /** The serif headline — trusted HTML. */
  headline: string;
  /** The email body — trusted HTML (compose with the helpers above). */
  bodyHtml: string;
  /** Second footer line — trusted HTML (escape user values first). */
  footerNote: string;
}

/**
 * Render the full transactional-email document around `opts.bodyHtml`: the
 * page frame, header colour band + wordmark, content column (eyebrow +
 * headline + body), and the two-line footer. Everything brand-specific comes
 * from `theme`; callers pass already-HTML-safe strings for the slots.
 */
export function renderEmailShell(theme: MailTheme, opts: EmailShellOptions): string {
  const { palette: p, fonts, brand } = theme;
  const radius = theme.radius ?? 6;
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:${p.pageBg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.pageBg};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${p.bg};border:1px solid ${p.rule};border-radius:${radius}px;overflow:hidden;">

<tr><td style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${band}</tr></table>
<div style="margin-top:${brandOffset}px;padding:0 40px 20px;position:relative;">
<span style="font-family:${fonts.serif};font-weight:400;font-size:${brandSize}px;color:${p.onDark};text-shadow:${brandShadow};">${brand.name}</span>
</div>
</td></tr>

<tr><td style="padding:40px 40px 36px;">
<p style="font-family:${fonts.mono};font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${p.accent};margin:0 0 18px;">${opts.eyebrow}</p>
<h1 style="font-family:${fonts.serif};font-weight:400;font-size:32px;line-height:1.1;letter-spacing:-0.01em;color:${p.ink};margin:0 0 20px;">${opts.headline}</h1>
${opts.bodyHtml}
</td></tr>

<tr><td style="padding:24px 40px 30px;background:${p.bgSoft};border-top:1px solid ${p.rule};">
<p style="font-family:${fonts.mono};font-size:11px;letter-spacing:0.04em;color:${p.inkMute};margin:0 0 6px;">${brand.footerLead}</p>
<p style="font-family:${fonts.mono};font-size:11px;letter-spacing:0.04em;color:${p.inkMute};margin:0;">${opts.footerNote}</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
