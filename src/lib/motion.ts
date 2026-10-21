import { quintOut } from "svelte/easing";

// The motion tokens Svelte transitions need as numbers and functions. CSS
// uses the same ones from layout.css (--ease-out-strong, --duration-*); keep
// the two in step.

/** --ease-out-strong. Its cubic-bezier(0.22, 1, 0.36, 1) is quintOut's curve. */
export const easeOutStrong = quintOut;

/** --ease-out-strong as a string, for the Web Animations API. */
export const EASE_OUT_STRONG_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

/** --duration-card: a deck card leaving, arriving, or moving up. */
export const CARD_MS = 200;

/** Fades that stand in for movement when the device asks for less motion. */
export const FADE_MS = 150;
