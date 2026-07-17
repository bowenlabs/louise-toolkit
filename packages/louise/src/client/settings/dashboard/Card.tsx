// Copyright (c) 2026 BowenLabs. Louise Toolkit is MIT licensed.
//
// The shared dashboard card wrapper — one title, an at-a-glance status dot, a
// plain-language body, and (at most) a single verb. Built-in and site cards
// render through this so they read as one system, the way Section/SettingsField
// are shared primitives for the Settings panel.

import { type JSX, Show } from "solid-js";
import type { CardStatus } from "./types.js";

/** The status dot's colour class — green when OK, amber when something needs
 *  attention. Loading/absent show no dot (absent cards don't render at all). */
function dotState(status?: CardStatus): "ok" | "attention" | undefined {
  if (status?.level === "ok") return "ok";
  if (status?.level === "attention") return "attention";
  return undefined;
}

export function Card(props: {
  /** Card heading, e.g. "Content", "Inbox". */
  title: string;
  /** Drives the status dot; the summary header aggregates the same value. */
  status?: CardStatus;
  /** The card's single verb — Publish / Reply / Fix / Review. Omit for none. */
  action?: { label: string; onClick: () => void };
  /** The plain-language line ("3 pages have unpublished changes"). */
  children: JSX.Element;
}): JSX.Element {
  return (
    <section class="louise-card">
      <header class="louise-card-head">
        <Show when={dotState(props.status)}>
          {(state) => <span class="louise-card-dot" data-state={state()} aria-hidden="true" />}
        </Show>
        <h3 class="louise-card-title">{props.title}</h3>
      </header>
      <div class="louise-card-body">{props.children}</div>
      <Show when={props.action}>
        {(action) => (
          <button class="louise-btn louise-card-action" type="button" onClick={action().onClick}>
            {action().label}
          </button>
        )}
      </Show>
    </section>
  );
}
