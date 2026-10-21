import type { Attachment } from "svelte/attachments";

import { EASE_OUT_STRONG_CSS } from "#lib/motion.ts";

import type { Answer } from "./deck.svelte.ts";

// Swiping the deck's card: left for Not seen, right for Seen, the same sides
// as the buttons. The buttons stay; this is an extra (spec section 1).

/** A drag past this share of the card's width answers when let go. */
const COMMIT_SHARE = 0.3;
/** A flick at least this fast (px per ms) answers however short it was. */
const FLICK_SPEED = 0.5;
/** How far the finger moves before the drag counts as sideways or not. */
const DEAD_ZONE = 8;
/** The card's tilt at a full card width of drag. */
const MAX_TILT = 12;
const SNAP_BACK_MS = 200;
/** Release speed is measured over the drag's last moments only. */
const VELOCITY_WINDOW_MS = 100;

interface Options {
  /** Read when a finger lands: false whenever the answer buttons are off. */
  enabled: () => boolean;
  /** Less motion: the card returns at once instead of animating back. */
  reducedMotion: () => boolean;
  onAnswer: (answer: Answer) => void;
}

/** Where a swiped card was let go, so its exit carries on from there. */
export interface Release {
  x: number;
  tilt: number;
  /** px per ms; negative is leftward. */
  velocity: number;
}

// Keyed by the element, so a release dies with its card.
const releases = new WeakMap<Element, Release>();

export function releaseOf(card: Element): Release | undefined {
  return releases.get(card);
}

/** The tilt for a drag of `x` px on a card `width` px wide. */
export function tiltFor(x: number, width: number): number {
  if (width === 0) return 0;
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, (x / width) * MAX_TILT));
}

/**
 * Whether a drag let go at `x` px, moving at `velocity` px per ms, answers.
 * Far enough answers unless the finger was flicking back; a fast flick
 * outward answers however short it was.
 */
export function commits(x: number, velocity: number, width: number): boolean {
  if (x === 0) return false;
  const outward = Math.sign(velocity) === Math.sign(x);
  const fast = Math.abs(velocity) > FLICK_SPEED;
  if (fast) return outward;
  return Math.abs(x) > width * COMMIT_SHARE;
}

/** Speed over the samples' last VELOCITY_WINDOW_MS, in px per ms. */
export function velocityOf(samples: readonly { x: number; t: number }[]) {
  const last = samples.at(-1);
  if (last === undefined) return 0;
  const first =
    samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last;
  const elapsed = last.t - first.t;
  return elapsed === 0 ? 0 : (last.x - first.x) / elapsed;
}

/**
 * The deck card follows a sideways drag 1:1 and answers when let go far
 * enough or fast enough; otherwise it springs back, and can be caught again
 * on the way. Put it on the card on screen only:
 * `{@attach isTop && swipe(...)}`.
 *
 * An attachment (Svelte 5): it runs when the element mounts and returns its
 * cleanup, like a React ref callback with a teardown. Positions are written
 * straight to the element's style, not to `$state`, so a drag never makes
 * Svelte re-render.
 */
export function swipe(options: Options): Attachment<HTMLElement> {
  return (card) => {
    const labels = {
      seen: card.querySelector<HTMLElement>('[data-swipe-label="seen"]'),
      notSeen: card.querySelector<HTMLElement>('[data-swipe-label="not_seen"]'),
    };
    let pointerId: number | null = null;
    // Sideways drag confirmed (past the dead zone, more across than down).
    let tracking = false;
    let startX = 0;
    let startY = 0;
    // Where the card was when the finger landed: 0, or mid snap-back.
    let origin = 0;
    let x = 0;
    let samples: { x: number; t: number }[] = [];
    let snapBack: Animation[] = [];

    function draw(nextX: number) {
      x = nextX;
      const width = card.offsetWidth;
      card.style.transform =
        x === 0
          ? ""
          : `translateX(${String(x)}px) rotate(${String(tiltFor(x, width))}deg)`;
      // The label fades in as the drag nears the point where it answers.
      const progress = Math.min(Math.abs(x) / (width * COMMIT_SHARE), 1);
      if (labels.seen) labels.seen.style.opacity = String(x > 0 ? progress : 0);
      if (labels.notSeen) {
        labels.notSeen.style.opacity = String(x < 0 ? progress : 0);
      }
    }

    function stopSnapBack() {
      for (const animation of snapBack) animation.cancel();
      snapBack = [];
    }

    // Back to the middle: animated from wherever it is, and interruptible,
    // because pointerdown cancels it and reads where it got to.
    function settle() {
      const from = card.style.transform;
      const opacities = [labels.seen, labels.notSeen].map(
        (label) => label?.style.opacity ?? "0"
      );
      draw(0);
      if (from === "" || options.reducedMotion()) return;
      const timing = {
        duration: SNAP_BACK_MS,
        // Web Animations take a curve, not a CSS variable.
        easing: EASE_OUT_STRONG_CSS,
      };
      snapBack = [
        card.animate([{ transform: from }, { transform: "none" }], timing),
      ];
      [labels.seen, labels.notSeen].forEach((label, index) => {
        if (label === null) return;
        snapBack.push(
          label.animate([{ opacity: opacities[index] }, { opacity: 0 }], timing)
        );
      });
    }

    function release() {
      if (pointerId !== null && card.hasPointerCapture(pointerId)) {
        card.releasePointerCapture(pointerId);
      }
      pointerId = null;
      tracking = false;
    }

    function onpointerdown(event: PointerEvent) {
      if (pointerId !== null || !event.isPrimary || event.button !== 0) return;
      if (!options.enabled()) return;
      // Caught on its way back: carry on from where it is right now.
      origin = x;
      if (snapBack.length > 0) {
        origin = new DOMMatrix(getComputedStyle(card).transform).m41;
        stopSnapBack();
        draw(origin);
      }
      pointerId = event.pointerId;
      tracking = false;
      startX = event.clientX;
      startY = event.clientY;
      samples = [{ x: event.clientX, t: event.timeStamp }];
    }

    function onpointermove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      if (!tracking) {
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
        // Mostly downward or upward: not a swipe. The page keeps it.
        if (Math.abs(dy) > Math.abs(dx)) {
          release();
          settle();
          return;
        }
        tracking = true;
        // Keeps the moves coming even when the finger leaves the card.
        card.setPointerCapture(event.pointerId);
      }
      samples.push({ x: event.clientX, t: event.timeStamp });
      if (samples.length > 20) samples.shift();
      draw(origin + event.clientX - startX);
    }

    function onpointerup(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      const wasTracking = tracking;
      release();
      if (!wasTracking) {
        if (x !== 0) settle();
        return;
      }
      // The release counts as a sample: a finger that stopped before
      // lifting has no speed left, however fast it moved earlier.
      samples.push({ x: event.clientX, t: event.timeStamp });
      const velocity = velocityOf(samples);
      const width = card.offsetWidth;
      if (commits(x, velocity, width) && options.enabled()) {
        releases.set(card, { x, tilt: tiltFor(x, width), velocity });
        options.onAnswer(x > 0 ? "seen" : "not_seen");
        return;
      }
      settle();
    }

    function onpointercancel(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      release();
      settle();
    }

    card.addEventListener("pointerdown", onpointerdown);
    card.addEventListener("pointermove", onpointermove);
    card.addEventListener("pointerup", onpointerup);
    card.addEventListener("pointercancel", onpointercancel);
    return () => {
      // Listeners only: an answered card keeps its position for its exit.
      card.removeEventListener("pointerdown", onpointerdown);
      card.removeEventListener("pointermove", onpointermove);
      card.removeEventListener("pointerup", onpointerup);
      card.removeEventListener("pointercancel", onpointercancel);
      stopSnapBack();
    };
  };
}
