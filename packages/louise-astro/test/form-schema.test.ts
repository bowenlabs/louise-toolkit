import { describe, expect, it } from "vitest";
import { formToAstroSchema } from "../src/form-schema.js";
import type { FormConfig } from "louise-toolkit/forms";

const form: FormConfig = {
  name: "inquiries",
  fields: {
    firstName: { type: "text", label: "First name", required: true },
    nickname: { type: "text", label: "Nickname" },
    email: { type: "email", label: "Email", required: true },
    website: { type: "url", label: "Website" },
    party: { type: "number", label: "Party size" },
    when: { type: "date", label: "Date" },
    subscribe: { type: "checkbox", label: "Subscribe" },
    regarding: { type: "select", label: "Regarding", options: ["sales", "support"] },
    resume: { type: "file", label: "Resume" },
  },
};

const schema = formToAstroSchema(form);

describe("formToAstroSchema", () => {
  it("accepts a valid submission and coerces by field type", () => {
    const out = schema.parse({
      firstName: "Ada",
      email: "ada@example.com",
      website: "https://ada.dev",
      party: "3", // string → number
      when: "2026-01-02",
      subscribe: "on", // form checkbox → boolean
      regarding: "support",
      resume: "/media/cv.pdf",
    }) as Record<string, unknown>;

    expect(out.party).toBe(3);
    expect(out.when).toBeInstanceOf(Date);
    expect(out.subscribe).toBe(true);
    expect(out.regarding).toBe("support");
  });

  it("enforces the built-in format checks", () => {
    const base = { firstName: "Ada", email: "ada@example.com" };
    expect(() => schema.parse({ ...base, email: "not-an-email" })).toThrow();
    expect(() => schema.parse({ ...base, website: "not a url" })).toThrow();
    expect(() => schema.parse({ ...base, regarding: "billing" })).toThrow(); // outside options
  });

  it('normalizes checkbox truthiness (boolean / 1 / "true")', () => {
    const parse = (subscribe: unknown) =>
      (schema.parse({ firstName: "A", email: "a@b.co", subscribe }) as { subscribe?: boolean })
        .subscribe;
    expect(parse(true)).toBe(true);
    expect(parse(1)).toBe(true);
    expect(parse("true")).toBe(true);
    expect(parse(false)).toBe(false);
    expect(parse("")).toBe(false);
  });

  it("treats non-required fields as optional (absent is fine)", () => {
    expect(() => schema.parse({ firstName: "Ada", email: "ada@example.com" })).not.toThrow();
  });

  it("rejects a missing required field and an empty required string", () => {
    expect(() => schema.parse({ email: "ada@example.com" })).toThrow(); // firstName missing
    expect(() => schema.parse({ firstName: "", email: "ada@example.com" })).toThrow(); // empty
  });
});
