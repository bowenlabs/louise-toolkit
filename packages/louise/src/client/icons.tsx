// Phosphor icons for Louise's editor + chrome. SVGs are imported raw from
// @phosphor-icons/core (regular weight) and inlined, so they inherit
// `currentColor` and size to `1em` — no icon font, no runtime fetch, CSP-safe.
import bold from "@phosphor-icons/core/assets/regular/text-b.svg?raw";
import italic from "@phosphor-icons/core/assets/regular/text-italic.svg?raw";
import underline from "@phosphor-icons/core/assets/regular/text-underline.svg?raw";
import strike from "@phosphor-icons/core/assets/regular/text-strikethrough.svg?raw";
import heading from "@phosphor-icons/core/assets/regular/text-h.svg?raw";
import paragraph from "@phosphor-icons/core/assets/regular/text-t.svg?raw";
import palette from "@phosphor-icons/core/assets/regular/palette.svg?raw";
import image from "@phosphor-icons/core/assets/regular/image.svg?raw";
import listBullets from "@phosphor-icons/core/assets/regular/list-bullets.svg?raw";
import listNumbers from "@phosphor-icons/core/assets/regular/list-numbers.svg?raw";
import quote from "@phosphor-icons/core/assets/regular/quotes.svg?raw";
import list from "@phosphor-icons/core/assets/regular/list.svg?raw";
import x from "@phosphor-icons/core/assets/regular/x.svg?raw";
import caretUp from "@phosphor-icons/core/assets/regular/caret-up.svg?raw";
import caretDown from "@phosphor-icons/core/assets/regular/caret-down.svg?raw";
import caretRight from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";
import dragHandle from "@phosphor-icons/core/assets/regular/dots-six-vertical.svg?raw";
import pencil from "@phosphor-icons/core/assets/regular/pencil-simple.svg?raw";
import check from "@phosphor-icons/core/assets/regular/check.svg?raw";
import trash from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import plus from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import minus from "@phosphor-icons/core/assets/regular/minus.svg?raw";
import signOut from "@phosphor-icons/core/assets/regular/sign-out.svg?raw";
import gear from "@phosphor-icons/core/assets/regular/gear.svg?raw";
import fileText from "@phosphor-icons/core/assets/regular/file-text.svg?raw";
import house from "@phosphor-icons/core/assets/regular/house.svg?raw";
import user from "@phosphor-icons/core/assets/regular/user.svg?raw";
import star from "@phosphor-icons/core/assets/regular/star.svg?raw";
import starFill from "@phosphor-icons/core/assets/fill/star-fill.svg?raw";

export const icons = {
  bold,
  italic,
  underline,
  strike,
  heading,
  paragraph,
  palette,
  image,
  listBullets,
  listNumbers,
  quote,
  list,
  x,
  caretUp,
  caretDown,
  caretRight,
  dragHandle,
  pencil,
  check,
  trash,
  plus,
  minus,
  signOut,
  gear,
  fileText,
  house,
  user,
  star,
  starFill,
} as const;

export type IconName = keyof typeof icons;

/** Inline Phosphor icon. `size` is a CSS length (default 1em). */
export function Icon(props: { name: IconName; size?: string; class?: string }) {
  return (
    <span
      class={`louise-icon ${props.class ?? ""}`}
      style={{ display: "inline-flex", width: props.size ?? "1em", height: props.size ?? "1em" }}
      aria-hidden="true"
      innerHTML={icons[props.name]}
    />
  );
}
