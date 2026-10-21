// In a .ts file rather than button.svelte's module script: ESLint can't read
// types out of .svelte files, so importing these from there loses them.
import type { ResolvedPathname } from "$app/types";
import type {
  HTMLAnchorAttributes,
  HTMLButtonAttributes,
} from "svelte/elements";
import { type VariantProps, tv } from "tailwind-variants";

import type { WithElementRef } from "#lib/utils.ts";

// Pressing shrinks the button a little the moment a finger lands, so a tap
// feels received even before anything else happens. Skipped for people who
// ask for less motion; menu triggers keep still while their menu opens.
export const buttonVariants = tv({
  base: "group/button inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-(--duration-press) ease-out-strong outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 motion-safe:active:not-aria-[haspopup]:scale-[0.97] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground hover:bg-primary/80",
      outline:
        "border-border bg-input/30 hover:bg-input/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
      secondary:
        "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
      ghost:
        "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
      destructive:
        "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
      link: "text-primary underline-offset-4 hover:underline",
    },
    size: {
      default:
        "h-11 gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
      xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
      sm: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
      lg: "h-13 gap-2 px-6 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
      icon: "size-11",
      "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
      "icon-sm": "size-9",
      "icon-lg": "size-13",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

// `href` must come from `resolve()`, like every internal link (lint rule
// svelte/no-navigation-without-resolve). For an external link, put
// `buttonVariants()` on a plain <a>.
export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
  WithElementRef<Omit<HTMLAnchorAttributes, "href">> & {
    href?: ResolvedPathname;
    variant?: ButtonVariant;
    size?: ButtonSize;
  };
