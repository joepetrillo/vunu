import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import HugeiconsIcon from "./HugeiconsIcon.svelte";

// Renders on the server, like the first HTML a browser gets: the icon's shapes
// must already be there, before any JavaScript runs.
describe("HugeiconsIcon", () => {
  it("draws the icon's shapes in the server-rendered markup", () => {
    const { body } = render(HugeiconsIcon, {
      props: { icon: ArrowLeft01Icon, class: "size-5" },
    });

    expect(body).toContain('class="size-5"');
    expect(body).toMatch(/<path d="M15 6C15 6[^"]*"/);
    expect(body).toContain('stroke-linecap="round"');
    expect(body).toContain('stroke-width="1.5"');
    expect(body).not.toContain(" key=");
  });

  it("overrides the stroke width when asked", () => {
    const { body } = render(HugeiconsIcon, {
      props: { icon: ArrowLeft01Icon, strokeWidth: 2 },
    });

    expect(body).toContain('stroke-width="2"');
    expect(body).not.toContain('stroke-width="1.5"');
  });
});
