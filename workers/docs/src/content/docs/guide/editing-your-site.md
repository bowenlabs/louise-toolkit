---
title: Editing your site
description: For the person who edits the site, not the one who built it—signing in, making changes, and publishing.
sidebar:
  order: 15
---

:::note[Who this page is for]
Everything else in these docs is written for a developer wiring Louise into a
site. This page is written for **you, the person editing it**—no code, nothing
to install. If someone sent you a link to this page, you are in the right place.
:::

Louise is an editor that lives **on your actual site**. There is no separate
admin app to log into and no preview that might not match: you sign in, the page
you are looking at becomes editable, and what you see is what visitors get.

## Signing in

Go to `/louise` on your site—so if your site is `example.com`, that's
`example.com/louise`—and enter your email address.

You will get a **magic link** by email. Click it and you are signed in. There is
no password to remember or lose.

:::caution[If no email arrives]
The sign-in page says the same thing whether or not your address is allowed to
edit. That is deliberate: it stops a stranger using the form to discover who
works on your site. So "I entered my email and nothing happened" usually means
**your address hasn't been added as an editor yet**, not that something is
broken. Ask whoever set the site up to add you.
:::

## Making a change

Once signed in, editable parts of the page get a subtle outline. Click one and
type. That's the whole interaction—there is no separate form to open.

What you can edit depends on how your site was built, but typically:

- **Text and headings**—click and type.
- **Rich text**—longer body content, with bold, italic, links and headings.
  Select some text and a small toolbar appears.
- **Images**—click one to replace it from your media library or upload a new file.
- **Sections**—whole blocks of a page (a hero, a gallery, a row of columns).
  Depending on the site, you may be able to add, reorder or remove them.

## Drafts and publishing

Your changes save as you work, but saving is **not** the same as publishing.

Edits land as a **draft**: only you (and other signed-in editors) see them. The
live site keeps showing the last published version until you choose to publish.
That means you can leave something half-finished, come back tomorrow, and no
visitor sees the work in progress.

When you're happy, **publish**. The change goes live immediately.

If your site keeps version history, you can look back at previous versions and
restore one—useful when a change reads worse than what it replaced.

## A few things worth knowing

**You cannot break the site by editing it.** The worst case is publishing
something you'd rather not have; restore an earlier version, or edit and publish
again.

**Sign out when you're on a shared computer.** An editor session is a real
session—anyone using that browser afterwards would be signed in as you.

**Changes are attributed.** If more than one person edits, the site records who
changed what, which is how you work out where a surprising change came from
rather than who to blame for it.

## When something looks wrong

In rough order of likelihood:

1. **The change didn't appear on the live site**—it's probably still a draft.
   Check whether you published.
2. **You're seeing an old version**—try a hard refresh. Pages are cached at
   the edge for speed, and a stale copy can linger briefly after publishing.
3. **You can't edit anything**—you may have been signed out. Go to `/louise`
   and sign in again.
4. **Something is genuinely broken**—tell whoever maintains the site, and
   include _what you clicked_ and _what happened instead_. That pair is almost
   always enough to find it.
