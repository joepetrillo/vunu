import { describe, expect, it } from "vitest";

import { commits, tiltFor, velocityOf } from "./swipe.ts";

const WIDTH = 300;

describe("commits", () => {
  it("answers a drag past 30% of the card, either way", () => {
    expect(commits(-100, 0, WIDTH)).toBe(true);
    expect(commits(100, 0, WIDTH)).toBe(true);
    expect(commits(80, 0, WIDTH)).toBe(false);
  });

  it("answers a short, fast flick outward", () => {
    expect(commits(30, 0.8, WIDTH)).toBe(true);
    expect(commits(-30, -0.8, WIDTH)).toBe(true);
  });

  it("doesn't answer a long drag being flicked back", () => {
    expect(commits(150, -0.8, WIDTH)).toBe(false);
  });

  it("never answers a card that didn't move", () => {
    expect(commits(0, 2, WIDTH)).toBe(false);
  });
});

describe("velocityOf", () => {
  it("measures only the drag's last 100 ms", () => {
    const samples = [
      { x: 0, t: 0 },
      { x: 10, t: 400 },
      { x: 60, t: 450 },
      { x: 110, t: 500 },
    ];
    expect(velocityOf(samples)).toBe(1);
  });

  it("is 0 with nothing to measure", () => {
    expect(velocityOf([])).toBe(0);
    expect(velocityOf([{ x: 5, t: 10 }])).toBe(0);
  });
});

describe("tiltFor", () => {
  it("tilts with the drag and stops at 12°", () => {
    expect(tiltFor(150, WIDTH)).toBe(6);
    expect(tiltFor(-600, WIDTH)).toBe(-12);
    expect(tiltFor(10, 0)).toBe(0);
  });
});
