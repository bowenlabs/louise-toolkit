// ADR 0001, layer 3—a Solid island that calls the typed `savePage` Action.
// The argument to `actions.louise.savePage` is inferred straight from
// `pageEditInput` (via `astro:actions` codegen), so the client and server agree
// on the shape with zero hand-maintained types. This is the same
// island → action pattern the sites already use (for example, themidwestartist's
// ContactForm → `actions.inquiry`), now end-to-end typed.
import { actions } from "astro:actions";
import { createSignal } from "solid-js";
import type { PageEditInput } from "../lib/louise/page-schema";

export default function SavePageFields(props: { page: PageEditInput }) {
  const [title, setTitle] = createSignal(props.page.title);
  const [seoTitle, setSeoTitle] = createSignal(props.page.seoTitle ?? "");
  const [state, setState] = createSignal<"idle" | "saving" | "saved" | "error">("idle");

  const save = async () => {
    setState("saving");
    // Fully inferred: the object below must match `pageEditInput`. A wrong shape
    // is a compile error—see the type-proof at the bottom of this file.
    const { error } = await actions.louise.savePage({
      id: props.page.id,
      title: title(),
      seoTitle: seoTitle() || undefined,
      seoDescription: props.page.seoDescription,
    });
    setState(error ? "error" : "saved");
  };

  return (
    <div class="louise-typed-save">
      <label>
        Title
        <input value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
      </label>
      <label>
        SEO title
        <input value={seoTitle()} onInput={(e) => setSeoTitle(e.currentTarget.value)} />
      </label>
      <button type="button" onClick={save} disabled={state() === "saving"}>
        Save
      </button>
      <span data-state={state()}>{state()}</span>
    </div>
  );
}

// Compile-time proof that the Action is typed from `pageEditInput`. If inference
// regressed (the arg went `any`), the `@ts-expect-error` would become unused and
// `astro check` would fail. Never executed.
async function _typeProof() {
  // @ts-expect-error—id must be a number and title a string
  await actions.louise.savePage({ id: "nope", title: 123 });
}
void _typeProof;
