// Which Fourthwall field a product's copy comes from—ported from
// themidwestartist.com, whose sync mirrored `description`, empty across nearly
// its whole catalog, while the copy a buyer wants sat in the More details panel.
//
// Worth pinning because the failure is invisible from the outside: reading the
// wrong field and reading a field the seller left blank produce the same row.
import { describe, expect, it, vi } from "vitest";
import { fourthwallCopy } from "../../src/core/commerce/fourthwall.js";

const base = { id: "p1", name: "Basking Print", slug: "basking-print", images: [], variants: [] };

const panel = (type: string, bodyHtml: string) => ({ type, title: type, bodyHtml });

describe("fourthwallCopy", () => {
  it("prefers the More details panel", () => {
    expect(
      fourthwallCopy({
        ...base,
        description: "short blurb",
        additionalInformation: [panel("MORE_DETAILS", "<p>Archival giclée on cotton rag.</p>")],
      }),
    ).toBe("<p>Archival giclée on cotton rag.</p>");
  });

  it("reads More details wherever it sits in the array", () => {
    // Fourthwall orders the accordion however the product was set up; picking
    // by position instead of by `type` would work until it didn't.
    expect(
      fourthwallCopy({
        ...base,
        additionalInformation: [
          panel("SIZE_AND_FIT", "<p>Measured flat.</p>"),
          panel("GUARANTEE_AND_RETURNS", "<p>30 days.</p>"),
          panel("MORE_DETAILS", "<p>Printed and packed by hand.</p>"),
        ],
      }),
    ).toBe("<p>Printed and packed by hand.</p>");
  });

  it("never returns Size and fit or Returns as the product copy", () => {
    // Those panels are boilerplate on every product. Falling back to them would
    // put "30 days" in the meta description of the entire shop.
    expect(
      fourthwallCopy({
        ...base,
        additionalInformation: [
          panel("SIZE_AND_FIT", "<p>Measured flat.</p>"),
          panel("GUARANTEE_AND_RETURNS", "<p>30 days.</p>"),
        ],
      }),
    ).toBeNull();
  });

  it("falls back to description when there is no More details panel", () => {
    expect(fourthwallCopy({ ...base, description: "A print of the painting." })).toBe(
      "A print of the painting.",
    );
  });

  it("falls back when More details exists but is blank", () => {
    // An empty panel is the same as no panel—trading an empty string for an
    // empty string would be a silent no-op that looks like it worked.
    expect(
      fourthwallCopy({
        ...base,
        description: "A print of the painting.",
        additionalInformation: [panel("MORE_DETAILS", "   ")],
      }),
    ).toBe("A print of the painting.");
  });

  it("returns null when neither field has anything", () => {
    // null, not ""—the column is nullable and an empty string would make
    // `product.details` truthy enough to render an empty block on the page.
    expect(fourthwallCopy(base)).toBeNull();
    expect(fourthwallCopy({ ...base, description: "  " })).toBeNull();
    expect(fourthwallCopy({ ...base, additionalInformation: [] })).toBeNull();
  });

  // ── Fourthwall's injected compliance block ─────────────────────────────────
  //
  // The seller types a few bullets in the Fourthwall editor. Fourthwall appends
  // an EU GPSR notice to the rendered panel, hidden behind `class="hidden"`,
  // naming its own fulfilment address—not the seller's. Mirroring it verbatim
  // would publish that address as the seller's and feed it to the meta
  // description.
  const GPSR =
    '<div class="hidden" style="padding-top: 10px">\n<p>EU GPSR Product Information:</p>\n<ul>\n<li>Manufacturer contact information</li>\n<li class="ql-indent-1">Postal address: PO Box 5696 Santa Monica, CA 90405</li>\n</ul>\n</div>';
  const SPECS = "<ul>\n<li>Paper thickness: 0.26mm</li>\n<li>Paper weight: 189 g/m²</li>\n</ul>";

  it("keeps the paper specs and drops the hidden compliance block", () => {
    const out = fourthwallCopy({
      ...base,
      additionalInformation: [panel("MORE_DETAILS", `${SPECS}\n${GPSR}`)],
    })!;
    expect(out).toContain("Paper thickness: 0.26mm");
    expect(out).toContain("189 g/m²");
    expect(out).not.toMatch(/GPSR/i);
    expect(out).not.toContain("Santa Monica");
    expect(out).not.toContain("PO Box");
    expect(out).not.toContain("support.order");
  });

  it("is a no-op when the API returns only what the seller typed", () => {
    // The API may well hand back exactly what was typed. The strip must not
    // touch it.
    expect(fourthwallCopy({ ...base, additionalInformation: [panel("MORE_DETAILS", SPECS)] })).toBe(
      SPECS,
    );
  });

  it("drops the whole panel rather than leak an address the strip missed, and says so", () => {
    // Markup drift: the block is no longer marked hidden, so the strip misses
    // it. Losing the paper specs is the acceptable failure here; printing
    // Fourthwall's address as the seller's is not.
    const onComplianceDropped = vi.fn();
    const product = {
      ...base,
      description: "A print of the painting.",
      additionalInformation: [
        panel("MORE_DETAILS", `${SPECS}<div><p>EU GPSR Product Information:</p></div>`),
      ],
    };
    expect(fourthwallCopy(product, { onComplianceDropped })).toBe("A print of the painting.");
    expect(onComplianceDropped).toHaveBeenCalledWith(product);
  });

  it("drops the panel rather than return an empty string once stripped", () => {
    // A panel that was nothing BUT the hidden block leaves "" behind. Returning
    // that would make `product.details` truthy enough to render an empty box.
    expect(fourthwallCopy({ ...base, additionalInformation: [panel("MORE_DETAILS", GPSR)] })).toBe(
      null,
    );
  });

  it("survives a shape Fourthwall did not promise", () => {
    // The panel array is data off the wire, not a type we control. A malformed
    // entry must not take the whole hourly sync down with it.
    const malformed = { ...base, additionalInformation: [null, undefined, {}] };
    expect(() => fourthwallCopy(malformed as never)).not.toThrow();
    expect(fourthwallCopy(malformed as never)).toBeNull();
    expect(fourthwallCopy({ ...base, additionalInformation: "nope" } as never)).toBeNull();
  });

  it("reads another panel when asked", () => {
    expect(
      fourthwallCopy(
        { ...base, additionalInformation: [panel("SIZE_AND_FIT", "<p>Measured flat.</p>")] },
        { panel: "SIZE_AND_FIT" },
      ),
    ).toBe("<p>Measured flat.</p>");
  });
});
