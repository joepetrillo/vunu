import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";

import HugeiconsIcon from "./HugeiconsIcon.svelte";

// Rendered in the browser, as after a client-side navigation: the shapes must
// be real SVG elements, or they take up no space and draw nothing.
describe("HugeiconsIcon in the browser", () => {
  it("creates its shapes as SVG elements", async () => {
    const { container } = await render(HugeiconsIcon, {
      icon: ArrowLeft01Icon,
    });

    const path = container.querySelector("svg path");
    expect(path?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(
      path instanceof SVGGeometryElement && path.getTotalLength()
    ).toBeGreaterThan(0);
  });
});
