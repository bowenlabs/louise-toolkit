# ADR 0021: One meaning for "published," and the page lifecycle

- **Status:** Proposed (2026-09-27)
- **Deciders:** Baylee (solo maintainer)
- **Related:** ADR 0009 (the MCP server), ADR 0010 (the editable-node model), ADR 0018 (editor design principles), issues #534, #537, #236, #540

## Context

Three things in a versioned collection are called "published," and they disagree:

| Name                                          | Where                      | Written by                                       | Read by                                                                                                  |
| --------------------------------------------- | -------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `status` (`draft` or `published`)             | the page row               | only `pagesRoute`, from the Pages panel's select | every site and Astroid, to decide whether a visitor sees the page, plus the sitemap and dashboard counts |
| `published_version_id`                        | the page row               | `publish` sets it; `unpublish` clears it         | the history drawer's **Live** row, `discardVersion`'s guard, and `latestPendingDraft`                    |
| a version's `status` (`draft` or `published`) | the `${slug}_versions` row | `publish` sets `published` and never demotes it  | the history drawer's **Published** label, and `publishScheduled`'s query                                 |

The code on `main` shows what that costs:

- **Publish doesn't make a page visible.** `publish` copies a snapshot onto the row and moves the pointer, but never writes `status`. A new page stays hidden after its **Publish** runs, and the Pages panel still reads Draft, until someone changes the Status select by hand. The MCP `publish_<slug>` tool promises to make a page live and can't, because no tool writes `status`.
- **Unpublish doesn't hide a page.** It clears the pointer and leaves `status` alone, so the page stays public. `versions.ts` says the site filters on the pointer; no site or Astroid does.
- **Unpublish brings superseded drafts back.** `latestPendingDraft` treats a draft as pending only when its ID is above the pointer. Clearing the pointer makes every old draft pending again. The next save then layers onto a stale snapshot, and "publish the latest draft" can put it live. Publishing an older version by ID does the same to every draft between the two.
- **A scheduled draft can undo a later publish.** `publishScheduled` promotes every due draft, including one a manual publish has since superseded. No caller schedules yet, so this is latent.
- **Two controls own visibility.** The Pages panel writes `status` directly, while the editor's **Publish** moves the pointer. Neither knows about the other.

## Decision

Each question has one source of truth, and the word "published" names one thing.

### 1. `status` on the page row is visibility, and only publish and unpublish write it

`status = 'published'` means a visitor can see the page. That's the only visibility signal, and sites and Astroid already read it. In a collection with drafts:

- `publish` sets `status = 'published'` in the same batch that copies the snapshot and moves the pointer.
- `unpublish` sets `status = 'draft'`.
- `pagesRoute` drops `status` from the fields it writes when `drafts` is configured, and answers a request that sends it with a `422` naming **Publish** and **Unpublish**. The Pages panel's Status select becomes those two actions.

A collection without drafts keeps writing `status` through `pagesRoute`, since there's nothing else to publish with.

In prose, the UI, and tool descriptions, the two values are **live** and **hidden**. The stored values stay `published` and `draft`, so no page row changes.

### 2. `published_version_id` is provenance, and unpublish keeps it

The pointer names the version whose snapshot the page row holds. `publish` moves it; nothing clears it. Unpublishing hides the page and leaves the row and the pointer as they were, so republishing puts the same content back, and `discardVersion` still refuses to delete the version that backs the row.

### 3. A version's state is derived, and "superseded" uses a high-water mark

A version row's stored `status` records one fact: `published` means the version has been promoted onto the page row at least once. It's never read as "live." A version's state comes from its row, the page's `status`, the pointer, and the **high-water mark**: the highest version ID ever promoted.

| State          | Rule                                                      | History drawer                          | Resume or open | "Publish latest" picks it | `publishScheduled` promotes it |
| -------------- | --------------------------------------------------------- | --------------------------------------- | -------------- | ------------------------- | ------------------------------ |
| **Pending**    | a draft, ID above the high-water mark, no `scheduledAt`   | Draft                                   | Resume         | Yes, the newest one       | No                             |
| **Scheduled**  | a draft, ID above the high-water mark, with `scheduledAt` | Scheduled, with the time                | Resume         | Yes, the newest one       | Yes, once due                  |
| **Superseded** | a draft, ID at or below the high-water mark               | Superseded                              | Open as draft  | No                        | No                             |
| **Current**    | the pointer's version                                     | Live, or Hidden when the page is hidden | Open as draft  | No                        | No                             |
| **Earlier**    | promoted once, and not the pointer's version              | Earlier                                 | Open as draft  | No                        | No                             |

The high-water mark replaces the pointer in `latestPendingDraft`, so neither an unpublish nor an explicit republish of an older version makes a superseded draft pending again. `publishScheduled` checks each due draft against its page's high-water mark as it goes, so a scheduled draft that a later publish superseded is skipped. A new exported helper, `versionState(version, page, highWater)`, is the one place the rule lives. The history drawer, the versions route, and MCP read it rather than each reading columns.

### 4. The page lifecycle

A page is in one of three states, from its row alone:

| Page state | `status`    | pointer | A visitor sees                 |
| ---------- | ----------- | ------- | ------------------------------ |
| **New**    | `draft`     | none    | nothing                        |
| **Live**   | `published` | set     | the pointer version's snapshot |
| **Hidden** | `draft`     | set     | nothing                        |

A collection without drafts has only live and hidden, set through `pagesRoute`.

| From   | Action                                     | To     | Writes                                                                          |
| ------ | ------------------------------------------ | ------ | ------------------------------------------------------------------------------- |
| none   | create                                     | New    | the row, `status = 'draft'`                                                     |
| New    | save a draft                               | New    | a pending version                                                               |
| New    | publish a version                          | Live   | snapshot onto the row, pointer, `status = 'published'`, version marked promoted |
| Live   | save a draft                               | Live   | a pending version; visitors still see the current one                           |
| Live   | publish a newer version                    | Live   | snapshot, pointer, version marked promoted                                      |
| Live   | open an earlier version as a draft         | Live   | a new pending version holding that snapshot (#540)                              |
| Live   | unpublish                                  | Hidden | `status = 'draft'`                                                              |
| Hidden | publish the current version or a newer one | Live   | as for New                                                                      |
| any    | a scheduled draft comes due                | Live   | as for publish, skipped when superseded                                         |
| any    | delete                                     | none   | the row and its versions                                                        |

Publishing an older version by ID stays in the API for scripts. It moves the pointer back, and the high-water mark keeps every draft since then superseded.

## Consequences

- **Publish means what it says.** One action puts a page in front of visitors, from the editor, the Pages panel, and MCP, so `publish_<slug>` keeps its promise and #236 can build on it. An `unpublish_<slug>` tool is a small follow-up there.
- **Visibility reads don't change.** Sites and Astroid already filter on `status = 'published'`, so they need no edit. The sitemap and dashboard counts stay right. One site copies the pointer-based superseded rule into its own draft lookup; it moves to `versionState` when site edits resume.
- **No schema change.** No column is added or renamed, and no stored value changes, so there's no expand-and-contract migration. The high-water mark is `MAX(id)` over a page's promoted versions, read from the same versions the route already loads for `latestPendingDraft`.
- **An upgrade edge.** A page unpublished before this lands has `status = 'published'` and no pointer, so it's still public, as it is today. The changeset gives the query that finds such pages, `status = 'published' AND published_version_id IS NULL` on a collection with drafts, so a site can decide each one by hand. Nothing is changed automatically, because a page created live without drafts looks the same.
- **Behavior changes, so it ships as `minor`:** `unpublish` hides; `publish` shows; `pagesRoute` refuses `status` on a collection with drafts; `latestPendingDraft` uses the high-water mark; `publishScheduled` skips superseded drafts.
- **The history drawer relabels rows** from `versionState`, and reads **Hidden** rather than **Live** for the current version of a hidden page. The versions `GET` adds the page's `status` and the high-water mark to its response.
- **One meaning for "published."** In docs, UI copy, and tool descriptions, "published" and "live" name page visibility only, and a version is pending, scheduled, superseded, current, or earlier. The glossary in #537 records these.

## Alternatives considered

- **Make the pointer the visibility signal**, as `versions.ts` claims. Rejected: every site and Astroid read `status`, so it would mean a change in every site's page route and sitemap during a pause on site edits. It also leaves a collection without drafts with no pointer to read.
- **Rename the stored version value from `published` to `promoted`.** Clearer in SQL, but it needs a data migration on every site's database for no change in behavior. Declined for now; `versionState` hides the stored value from every reader in the kit, so the rename stays cheap to do later.
- **Keep clearing the pointer on unpublish, and compute "superseded" from the versions alone.** The high-water mark does compute it from the versions alone, which fixes the resurrection either way. Clearing the pointer would still lose which content a republish restores, and it would let `discardVersion` delete the snapshot that backs a hidden page.
- **Store a lifecycle state column on the page row** (`new`, `live`, `hidden`). Rejected as a second source of truth beside `status` and the pointer, the problem this ADR exists to fix.
