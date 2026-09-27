// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// louise-toolkit/client—headless <Form> render helper (issue #46, Tier 2). Emits
// accessible inputs from a `defineForm` catalog, mirrors the SAME server
// validation client-side (reuses `validateSubmission` → the shared Rule engine—no
// second validation definition), and POSTs to the form's `formRoute`. Field
// state is a Solid `createStore` (the same lightweight approach `mountSections`
// uses); no form-state dependency.
//
// For a COMPLEX form—multi-step, field arrays, cross-field rules—hand-build
// it with `@tanstack/solid-form` and keep Louise's one validation definition via
// `tanstackFormValidators` (louise-toolkit/forms). Wire those to TanStack's
// `onChangeAsync` slot, not `onChange`: they are async by contract, and a
// promise in a sync slot is stored AS the promise, so validation silently never
// appears (#316).
//
// There is deliberately NO generated solid-form scaffold. `defineForm` is flat
// by construction—one column per field, no arrays, no nesting—so anything
// generated from it is a flat form, which is exactly what `<Form>` above already
// renders with no dependency at all. The scaffold would cost a peer dependency
// and an export subpath to do the same job worse; what a complex form actually
// needs from Louise is the validator bridge, not a component (#313).
//
// Unstyled by default: every element carries a `louise-form*` class hook so a
// site keeps its own look. Import `injectStyles` if you want the Louise chrome.

import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import {
  type RenderTurnstileOptions,
  renderTurnstile,
  type TurnstileWidget,
} from "../core/forms/turnstile-client.js";
import type { FormConfig, FormField } from "../core/forms/types.js";
import { validateSubmission } from "../core/forms/validate.js";

export interface FormProps {
  /** The form definition (from `defineForm`)—its fields + name drive rendering. */
  form: FormConfig;
  /** POST target. Default `/api/louise/forms/<name>` (matches `formRoute`). */
  action?: string;
  /**
   * Where a `file` field uploads, which answers `{ url }`. No default: the
   * toolkit's media route is for editors, so a visitor's upload needs a route
   * of the site's own, wrapped in `publicRoute` with its own size, type, and
   * rate limits. Without it, a form with a `file` field logs an error at mount
   * and refuses the upload.
   */
  mediaAction?: string;
  /**
   * Render a Turnstile widget above the submit button and send its token as
   * `cf-turnstile-response`. Set it when the form declares `spam.turnstile`
   * and the site passes `formRoute` a `turnstileSecret`, or every submit is
   * refused. Take `siteKey` from `activeCaptcha`, so the widget and the server
   * check stay on or off together.
   */
  turnstile?: Pick<RenderTurnstileOptions, "siteKey" | "appearance" | "action" | "theme">;
  /** Message shown after a successful submit. Default "Thanks—we'll be in touch." */
  successMessage?: string;
  /** Called after a 201. */
  onSuccess?: () => void;
  /** Extra class on the `<form>`. */
  class?: string;
}

type Status = "idle" | "submitting" | "success" | "error";

/** The status line after a check fails: how many fields need attention. */
function attentionMessage(count: number): string {
  return count === 1 ? "1 field needs attention." : `${count} fields need attention.`;
}

/** A field's element ID. Prefixed with the form's name, so two forms on one
 *  page that both have an `email` field don't share an ID. */
function fieldId(formName: string, key: string): string {
  return `louise-f-${formName}-${key}`;
}

const FALLBACK_ERROR = "Couldn't send your message. Try again in a minute.";
const SPAM_CHECK_ERROR = "Couldn't confirm this came from a person. Try again.";
const SPAM_CHECK_UNAVAILABLE =
  "The spam check didn't load, so this form can't send. Reload the page and try again.";
const UPLOAD_UNAVAILABLE = "Uploads aren't set up for this form.";

export function Form(props: FormProps): JSX.Element {
  const entries = () => Object.entries(props.form.fields);
  const [values, setValues] = createStore<Record<string, unknown>>({});
  const [errors, setErrors] = createStore<Record<string, string>>({});
  const [status, setStatus] = createSignal<Status>("idle");
  const [message, setMessage] = createSignal("");
  const [uploading, setUploading] = createSignal<string | null>(null);
  // Anti-spam telemetry (Tier 3): when the form mounted, and the honeypot value.
  // Both ride along in the POST body; the server's `looksLikeSpam` reads them.
  const mountedAt = Date.now();
  const honeypot = () => props.form.spam?.honeypot;
  const [honeypotValue, setHoneypotValue] = createSignal("");

  const action = () => props.action ?? `/api/louise/forms/${props.form.name}`;

  // Turnstile: rendered after mount, reset after any failed submit (a token is
  // single-use, even when the submit fails for another reason).
  let turnstileHost: HTMLDivElement | undefined;
  let widget: TurnstileWidget | undefined;
  onMount(() => {
    const hasFile = Object.values(props.form.fields).some((f) => f.type === "file");
    if (hasFile && !props.mediaAction) {
      console.error(
        `[louise] <Form name="${props.form.name}">: a file field needs mediaAction, a public upload route of the site's own. The editor media route refuses visitors.`,
      );
    }
    const turnstile = props.turnstile;
    if (!turnstile || !turnstileHost) return;
    renderTurnstile(turnstileHost, turnstile).then(
      (w) => {
        widget = w;
      },
      () => {
        setStatus("error");
        setMessage(SPAM_CHECK_UNAVAILABLE);
      },
    );
  });
  onCleanup(() => widget?.remove());

  const setError = (key: string, msg: string | undefined) =>
    setErrors(key, msg === undefined ? (undefined as unknown as string) : msg);

  /**
   * Paint field errors, then move focus to the first invalid field and say in
   * the status region how many need attention, so a screen reader user hears
   * that the submit didn't go through and lands where to fix it. Violations
   * whose path matches no field go into the status region instead, since
   * there's no field to show them next to. Returns whether anything was wrong.
   */
  function showViolations(violations: readonly { path: string; message: string }[]): boolean {
    const keys = Object.keys(props.form.fields);
    const next: Record<string, string> = {};
    const unmatched: string[] = [];
    for (const v of violations) {
      if (!keys.includes(v.path)) unmatched.push(v.message);
      else if (!next[v.path]) next[v.path] = v.message;
    }
    for (const key of keys) setError(key, next[key]);
    const invalid = keys.filter((key) => next[key] !== undefined);
    if (invalid.length === 0 && unmatched.length === 0) return false;
    setStatus("error");
    setMessage(
      [invalid.length > 0 ? attentionMessage(invalid.length) : "", ...unmatched]
        .filter(Boolean)
        .join(" "),
    );
    if (invalid.length > 0) {
      document.getElementById(fieldId(props.form.name, invalid[0] as string))?.focus();
    }
    return true;
  }

  /** Run the shared validation and paint field errors. Returns validity. */
  async function validate(): Promise<boolean> {
    const { violations } = await validateSubmission(props.form, values);
    return !showViolations(violations.filter((v) => v.severity === "error"));
  }

  async function uploadFile(key: string, file: File): Promise<void> {
    setError(key, undefined);
    if (!props.mediaAction) {
      setError(key, UPLOAD_UNAVAILABLE);
      return;
    }
    setUploading(key);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(props.mediaAction, {
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
    if (!(await validate())) return;
    if (props.turnstile && !widget) {
      setStatus("error");
      setMessage(SPAM_CHECK_UNAVAILABLE);
      return;
    }
    try {
      const payload: Record<string, unknown> = { ...values, louise_ts: mountedAt };
      if (honeypot()) payload[honeypot() as string] = honeypotValue();
      if (widget) payload["cf-turnstile-response"] = widget.token();
      const res = await fetch(action(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setValues({});
        setStatus("success");
        setMessage(props.successMessage ?? "Thanks—we'll be in touch.");
        props.onSuccess?.();
        return;
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as {
          violations?: { path: string; message: string }[];
        };
        if (!showViolations(body.violations ?? [])) {
          setStatus("error");
          setMessage(FALLBACK_ERROR);
        }
        widget?.reset();
        return;
      }
      setStatus("error");
      setMessage(
        res.status === 429
          ? "Too many messages. Try again soon."
          : res.status === 403
            ? SPAM_CHECK_ERROR
            : FALLBACK_ERROR,
      );
      widget?.reset();
    } catch {
      setStatus("error");
      setMessage("Network error. Try again.");
      widget?.reset();
    }
  }

  return (
    // `method` and `action` are the no-script path: a copy submitted before
    // the script runs, or after it fails, posts to `formRoute` rather than
    // sending every answer to the current page in a GET's query string.
    <form
      class={`louise-form${props.class ? ` ${props.class}` : ""}`}
      method="post"
      action={action()}
      novalidate
      onSubmit={onSubmit}
    >
      <For each={entries()}>
        {([key, field]) => (
          <FormRow
            id={fieldId(props.form.name, key)}
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
            onRemoveFile={() => setValues(key, undefined)}
          />
        )}
      </For>
      <Show when={honeypot()}>
        {/* Honeypot: off-screen + hidden from AT/autofill; a human never fills it. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
          <input
            type="text"
            name={honeypot()}
            tabindex="-1"
            autocomplete="off"
            value={honeypotValue()}
            onInput={(e) => setHoneypotValue(e.currentTarget.value)}
          />
        </div>
      </Show>
      <Show when={props.turnstile}>
        <div class="louise-form-turnstile" ref={turnstileHost} />
      </Show>
      <button class="louise-form-submit" type="submit" disabled={status() === "submitting"}>
        {status() === "submitting" ? "Sending…" : (props.form.submitLabel ?? "Send")}
      </button>
      {/* Always in the DOM, so a screen reader is already listening when the
          message changes; a live region added with its text isn't reliably read. */}
      <p class="louise-form-status" data-status={status()} role="status" aria-live="polite">
        {message()}
      </p>
    </form>
  );
}

/** One field row: label + the type-appropriate control + inline error/help. */
function FormRow(props: {
  id: string;
  name: string;
  field: FormField;
  value: unknown;
  error: string | undefined;
  uploading: boolean;
  onValue: (v: unknown) => void;
  onFile: (f: File) => void;
  onRemoveFile: () => void;
}): JSX.Element {
  let fileInput: HTMLInputElement | undefined;
  const id = () => props.id;
  const errId = () => `${id()}-err`;
  const helpId = () => `${id()}-help`;
  const describedBy = () =>
    [props.field.help ? helpId() : "", props.error ? errId() : ""].filter(Boolean).join(" ") ||
    undefined;
  // `required` as well as `aria-required`: the form is `novalidate`, so no
  // browser bubble appears, and it gives a site a `:required` styling hook.
  const common = () => ({
    id: id(),
    name: props.name,
    required: props.field.required === true,
    "aria-required": props.field.required ? true : undefined,
    "aria-invalid": props.error ? true : undefined,
    "aria-describedby": describedBy(),
    autocomplete: props.field.autocomplete as JSX.HTMLAutocomplete | undefined,
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
          inputmode={props.field.inputmode}
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
          ref={fileInput}
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
          <span class="louise-form-hint">Uploaded.</span>{" "}
          <button
            type="button"
            class="louise-form-remove"
            aria-label={`Remove the uploaded file from ${props.field.label}`}
            onClick={() => {
              if (fileInput) fileInput.value = "";
              props.onRemoveFile();
              fileInput?.focus();
            }}
          >
            Remove
          </button>
        </Show>
      </Show>

      <Show when={isTextInput(props.field.type)}>
        <input
          class="louise-form-input"
          type={inputType(props.field.type)}
          {...common()}
          inputmode={
            props.field.inputmode ?? (props.field.type === "number" ? "decimal" : undefined)
          }
          placeholder={props.field.placeholder}
          value={strValue()}
          onInput={(e) => props.onValue(e.currentTarget.value)}
        />
      </Show>

      <Show when={props.field.help}>
        <span class="louise-form-hint" id={helpId()}>
          {props.field.help}
        </span>
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
    // A number is typed as text, with a numeric keyboard: `type="number"`
    // throws away `1,200`, adds spinners, and changes on a scroll. The shared
    // validation reads the number, under the form's locale.
    case "number":
      return "text";
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
