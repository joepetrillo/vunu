import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";

import JoinCodeForm from "./JoinCodeForm.svelte";

// `use:enhance` needs a SvelteKit app around it; typing doesn't.
vi.mock("$app/forms", () => ({ enhance: () => ({}) }));

it("keeps only what can be in a code, uppercased, six at most", async () => {
  await render(JoinCodeForm, {});
  const input = page.getByLabelText("Join with a code");

  // Tap first, like a person: the field ignores focus nobody asked for.
  await userEvent.click(input);
  // 0, O, 1, I, L and punctuation never appear in codes.
  await userEvent.keyboard("k7q-0o1il m2x99");
  await expect.element(input).toHaveValue("K7QM2X");
});

it("cleans up a pasted code", async () => {
  await render(JoinCodeForm, {});
  const input = page.getByLabelText("Join with a code");
  // One input event with the whole value, like a paste.
  await userEvent.fill(input, " k7q-m2x ");
  await expect.element(input).toHaveValue("K7QM2X");
});

it("shows the error next to the field", async () => {
  await render(JoinCodeForm, { error: "That's not an active invite code." });
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("That's not an active invite code.");
  await expect
    .element(page.getByLabelText("Join with a code"))
    .toHaveAttribute("aria-invalid", "true");
});

it("refuses focus that no tap or key caused, then focuses normally", async () => {
  await render(JoinCodeForm, {});
  const input = page.getByLabelText("Join with a code");
  // What iOS Safari does on load.
  input.element().focus();
  expect(document.activeElement).not.toBe(input.element());

  await userEvent.click(input);
  expect(document.activeElement).toBe(input.element());
});
