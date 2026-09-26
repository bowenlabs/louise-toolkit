// Tests for the strings extractor in the house Vale package,
// vale/package/styles/Louise/copy-extract.mjs, which decides which strings
// `lint:docs` reads as prose. A form it misses is a form nobody checks, so each
// form it reads has a case here. `lint:docs` runs this file first.
//
// Run it on its own with `node --test scripts/ci/checks/copy-extract.test.mjs`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractStrings } from "../../../vale/package/styles/Louise/copy-extract.mjs";

/** The prose the extractor finds in `source`, read as a `.tsx` file. */
const texts = (source) => extractStrings("example.tsx", source).map((s) => s.text);

describe("extractStrings", () => {
  it("reads error constructors and json bodies", () => {
    assert.deepEqual(
      texts(`
        throw new LouiseAuthError("Sign in first.");
        return json({ error: "Not found here.", status: 404 });
      `),
      ["Sign in first.", "Not found here."],
    );
  });

  it("reads JSX text and the attributes a person reads", () => {
    assert.deepEqual(
      texts(`const a = <button title="Save the page" class="not prose">Save now</button>;`),
      ["Save the page", "Save now"],
    );
  });

  it("reads the first argument to setError, setMessage, and confirm", () => {
    assert.deepEqual(
      texts(`
        setError("Couldn't save.");
        props.setMessage("Saved.");
        if (window.confirm("Delete this page?")) remove();
        setOther("Not a message");
      `),
      ["Couldn't save.", "Saved.", "Delete this page?"],
    );
  });

  it("reads a textContent assignment", () => {
    assert.deepEqual(texts(`status.textContent = "Thanks for writing.";`), ["Thanks for writing."]);
  });

  it("reads each string branch of a conditional or logical value", () => {
    assert.deepEqual(
      texts(`
        setError(res.status === 429 ? "Too many tries." : "Something went wrong.");
        setMessage(custom ?? "Sent it.");
        const b = <p title={busy() ? "Saving now" : "Saved it"} />;
      `),
      ["Too many tries.", "Something went wrong.", "Sent it.", "Saving now", "Saved it"],
    );
  });

  it("reads strings inside a JSX child expression", () => {
    assert.deepEqual(
      texts(`const a = <p>{busy() ? "Saving now" : "Save"}{done() && "All done"}</p>;`),
      ["Saving now", "Save", "All done"],
    );
  });

  it("keeps the space around a JSX string that runs into a sibling", () => {
    assert.deepEqual(texts('const a = <p>{n() ? `Used in ${n()} — ` : ""}saves now.</p>;'), [
      "Used in `value` — `value`",
      "saves now.",
    ]);
  });

  it("ignores values it can't read as prose, and calls it doesn't list", () => {
    assert.deepEqual(
      texts(`
        setError(err.message);
        console.log("A log line for whoever maintains this.");
        const a = <p>{count()}</p>;
      `),
      [],
    );
  });
});
