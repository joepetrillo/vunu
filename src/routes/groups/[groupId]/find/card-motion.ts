import type { TransitionConfig } from "svelte/transition";

import { CARD_MS, easeOutStrong, FADE_MS } from "#lib/motion.ts";

import type { Answer } from "./deck.svelte.ts";
import { releaseOf } from "./swipe.ts";

// How the deck's cards come and go. Custom Svelte transitions: each returns
// a `css(t, u)` that Svelte turns into a Web Animation. `t` runs 0 → 1 on
// the way in and 1 → 0 on the way out; `u` is 1 - t.

/** How far a card travels sideways as it leaves or comes back. */
const TRAVEL = 360;

/** Not seen leaves to the left, Seen to the right, like the buttons. */
function sideOf(answer: Answer): number {
  return answer === "seen" ? 1 : -1;
}

interface LeaveOptions {
  /** The answer that took this card off the deck; none if it was replaced. */
  answer: Answer | undefined;
  reducedMotion: boolean;
}

/**
 * A card leaving. The answered card flies off toward its answer's side,
 * carrying on from where a swipe let it go; a card behind that a refresh
 * replaced just fades. With less motion, both fade where they are.
 */
export function cardLeave(
  node: HTMLElement,
  { answer, reducedMotion }: LeaveOptions
): TransitionConfig {
  const opacity = Number(getComputedStyle(node).opacity);
  if (answer === undefined || reducedMotion) {
    return {
      duration: FADE_MS,
      css: (t) => `opacity: ${String(t * opacity)}`,
    };
  }
  const release = releaseOf(node);
  const from = release?.x ?? 0;
  const tilt = release?.tilt ?? 0;
  const to = from + sideOf(answer) * TRAVEL;
  // A flung card leaves at the speed it was thrown: the time the rest of
  // the trip takes at its release speed, kept within reason.
  const duration =
    release === undefined || release.velocity === 0
      ? CARD_MS
      : Math.min(Math.max(TRAVEL / Math.abs(release.velocity), 120), 220);
  return {
    duration,
    easing: easeOutStrong,
    css: (t, u) =>
      `transform: translateX(${String(from + (to - from) * u)}px) rotate(${String(tilt)}deg); opacity: ${String(t * opacity)}`,
  };
}

interface ArriveOptions {
  /**
   * For a card Undo brought back: the answer it had, so it returns from
   * that side (undefined when it was answered on another visit).
   */
  undone: { answer: Answer | undefined } | undefined;
  reducedMotion: boolean;
}

/**
 * A card arriving. One that Undo brought back returns the way it left; a
 * new card behind simply fades in to its place.
 */
export function cardArrive(
  node: HTMLElement,
  { undone, reducedMotion }: ArriveOptions
): TransitionConfig {
  const opacity = Number(getComputedStyle(node).opacity);
  const answer = undone?.answer;
  if (answer === undefined || reducedMotion) {
    return {
      duration: undone === undefined || reducedMotion ? FADE_MS : CARD_MS,
      easing: easeOutStrong,
      css: (t) => `opacity: ${String(t * opacity)}`,
    };
  }
  const from = sideOf(answer) * TRAVEL;
  return {
    duration: CARD_MS,
    easing: easeOutStrong,
    css: (t, u) =>
      `transform: translateX(${String(from * u)}px); opacity: ${String(t * opacity)}`,
  };
}
