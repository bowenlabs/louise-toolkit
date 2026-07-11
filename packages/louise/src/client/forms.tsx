// Copyright (c) 2026 BowenLabs. Louise (louisecms) is MIT licensed.
//
// louisecms/client — headless <Form> render helper (issue #46, Tier 2). Emits
// accessible inputs from a `defineForm` catalog, mirrors the SAME server
// validation client-side (reuses `validateSubmission` → the shared Rule engine —
// no second validation definition), and POSTs to the form's `formRoute`. Field
// state is a Solid `createStore` (the same lightweight approach `mountSections`
// uses); no form-state dependency. For complex/multi-step forms, an opt-in
// `@tanstack/solid-form` scaffold lives in `louisecms/client/tanstack-form`.
//
// Unstyled by default: every element carries a `louise-form*` class hook so a
// site keeps its own look. Import `injectStyles` if you want the Louise chrome.

import { createSignal, For, type JSX, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import type { FormConfig, FormField } from "../core/forms/types.js";
import { validateSubmission } from "../core/forms/validate.js";

export interface FormProps {
  /** The form definition (from `defineForm`) — its fields + name drive rendering. */
  form: FormConfig;
  /** POST target. Default `/api/louise/forms/<name>` (matches `formRoute`). */
  action?: string;
  /** Media upload endpoint for `file` fields. Default `/api/louise/media`. */
  mediaAction?: string;
  /** Message shown after a successful submit. Default "Thanks — we'll be in touch." */
  successMessage?: string;
  /** Called after a 201. */
  onSuccess?: () => void;
  /** Extra class on the `<form>`. */
  class?: string;
}

type Status = "idle" | "submitting" | "success" | "error";

export function Form(props: FormProps): JSX.Element {
  const entries = () => Object.entries(props.form.fields);
  const [values, setValues] = createStore<Record<string, unknown>>({});
  const [errors, setErrors] = createStore<Record<string, string>>({});
  const [status, setStatus] = createSignal<Status>("idle");
  const [message, setMessage] = createSignal("");
  const [uploading, setUploading] = createSignal<string | null>(null);

  const action = () => props.action ?? `/api/louise/forms/${props.form.name}`;

  const setError = (key: string, msg: string | undefined) =>
    setErrors(key, msg === undefined ? (undefined as unknown as string) : msg);

  /** Run the shared validation and paint field errors. Returns validity. */
  async function validate(): Promise<boolean> {
    const { violations } = await validateSubmission(props.form, values);
    const next: Record<string, string> = {};
    for (const v of violations) {
      if (v.severity === "error" && !next[v.path]) next[v.path] = v.message;
    }
    for (const key of Object.keys(props.form.fields)) setError(key, next[key]);
    return Object.keys(next).length === 0;
  }

  async function uploadFile(key: string, file: File): Promise<void> {
    setUploading(key);
    setError(key, undefined);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(props.mediaAction ?? "/api/louise/media", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(key, body.error || `Upload failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (body.url) setValues(key, body.url);
    } catch {
      setError(key, "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function onSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setMessage("");
    setStatus("submitting");
    if (!(await validate())) {
      setStatus("idle");
      return;
    }
    try {
      const res = await fetch(action(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        setValues({});
        setStatus("success");
        setMessage(props.successMessage ?? "Thanks — we'll be in touch.");
        props.onSuccess?.();
        return;
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as {
          violations?: { path: string; message: string }[];
        };
        for (const v of body.violations ?? []) setError(v.path, v.message);
        setStatus("idle");
        return;
      }
      setStatus("error");
      setMessage(
        res.status === 429 ? "Too many messages — try again soon." : "Something went wrong.",
      );
    } catch {
      setStatus("error");
      setMessage("Network error — please try again.");
    }
  }

  return (
    <form
      class={`louise-form${props.class ? ` ${props.class}` : ""}`}
      novalidate
      onSubmit={onSubmit}
    >
      <For each={entries()}>
        {([key, field]) => (
          <FormRow
            name={key}
            field={field}
            value={values[key]}
            error={errors[key]}
            uploading={uploading() === key}
            onValue={(v) => {
              setValues(key, v);
              if (errors[key]) setError(key, undefined);
            }}
            onFile={(f) => void uploadFile(key, f)}
          />
        )}
      </For>
      <button class="louise-form-submit" type="submit" disabled={status() === "submitting"}>
        {status() === "submitting" ? "Sending…" : (props.form.submitLabel ?? "Send")}
      </button>
      <Show when={message()}>
        <p class="louise-form-status" data-status={status()} role="status" aria-live="polite">
          {message()}
        </p>
      </Show>
    </form>
  );
}

/** One field row: label + the type-appropriate control + inline error/help. */
function FormRow(props: {
  name: string;
  field: FormField;
  value: unknown;
  error: string | undefined;
  uploading: boolean;
  onValue: (v: unknown) => void;
  onFile: (f: File) => void;
}): JSX.Element {
  const id = () => `louise-f-${props.name}`;
  const errId = () => `${id()}-err`;
  const common = () => ({
    id: id(),
    name: props.name,
    "aria-invalid": props.error ? true : undefined,
    "aria-describedby": props.error ? errId() : undefined,
  });
  const strValue = () => (props.value == null ? "" : String(props.value));

  return (
    <div class="louise-form-row" data-field={props.name}>
      <Show when={props.field.type !== "checkbox"}>
        <label class="louise-form-label" for={id()}>
          {props.field.label}
          <Show when={props.field.required}>
            <span class="louise-form-req" aria-hidden="true">
              {" *"}
            </span>
          </Show>
        </label>
      </Show>

      <Show when={props.field.type === "textarea"}>
        <textarea
          class="louise-form-input"
          {...common()}
          placeholder={props.field.placeholder}
          value={strValue()}
          onInput={(e) => props.onValue(e.currentTarget.value)}
        />
      </Show>

      <Show when={props.field.type === "select"}>
        <select
          class="louise-form-input"
          {...common()}
          value={strValue()}
          onChange={(e) => props.onValue(e.currentTarget.value)}
        >
          <option value="">Choose…</option>
          <For each={props.field.options ?? []}>{(opt) => <option value={opt}>{opt}</option>}</For>
        </select>
      </Show>

      <Show when={props.field.type === "checkbox"}>
        <label class="louise-form-check">
          <input
            type="checkbox"
            {...common()}
            checked={props.value === true}
            onChange={(e) => props.onValue(e.currentTarget.checked)}
          />
          {props.field.label}
        </label>
      </Show>

      <Show when={props.field.type === "file"}>
        <input
          type="file"
          class="louise-form-input"
          {...common()}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) props.onFile(f);
          }}
        />
        <Show when={props.uploading}>
          <span class="louise-form-hint">Uploading…</span>
        </Show>
        <Show when={props.value}>
          <span class="louise-form-hint">Uploaded ✓</span>
        </Show>
      </Show>

      <Show when={isTextInput(props.field.type)}>
        <input
          class="louise-form-input"
          type={inputType(props.field.type)}
          {...common()}
          placeholder={props.field.placeholder}
          value={strValue()}
          onInput={(e) => props.onValue(e.currentTarget.value)}
        />
      </Show>

      <Show when={props.field.help}>
        <span class="louise-form-hint">{props.field.help}</span>
      </Show>
      <Show when={props.error}>
        <span class="louise-form-error" id={errId()}>
          {props.error}
        </span>
      </Show>
    </div>
  );
}

/** The plain single-line inputs (everything not handled by a dedicated branch). */
function isTextInput(type: FormField["type"]): boolean {
  return (
    type === "text" ||
    type === "email" ||
    type === "tel" ||
    type === "url" ||
    type === "number" ||
    type === "date"
  );
}

function inputType(type: FormField["type"]): string {
  switch (type) {
    case "email":
      return "email";
    case "tel":
      return "tel";
    case "url":
      return "url";
    case "number":
      return "number";
    case "date":
      return "date";
    default:
      return "text";
  }
}

/**
 * Mount a {@link Form} into a DOM node for a non-Solid site (mirrors
 * `mountSections`). Returns a disposer. The host's markup is replaced by the
 * rendered form.
 */
export function mountForm(host: HTMLElement, props: FormProps): () => void {
  return render(() => <Form {...props} />, host);
}
