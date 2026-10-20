import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";

import JoinCodeForm from "./JoinCodeForm.svelte";

// `use:enhance` needs a SvelteKit app around it; typing doesn't.
vi.mock("$app/forms", () => ({ enhance: () => ({}) }));

// Filling the last box submits the form. Count submits instead of letting
// them reload the test page.
const submitted = vi.fn((event: SubmitEvent) => {
  event.preventDefault();
});
document.addEventListener("submit", submitted);
beforeEach(() => {
  submitted.mockClear();
});

it("keeps letters and digits, uppercased, six at most", async () => {
  await render(JoinCodeForm, {});
  const input = page.getByLabelText("Invite code");

  await userEvent.click(input);
  // Punctuation and spaces never land in a box.
  await userEvent.keyboard("k7q- m2x");
  await expect.element(input).toHaveValue("K7QM2X");
  // Once full, typing replaces the last box instead of growing the code.
  await userEvent.keyboard("9");
  await expect.element(input).toHaveValue("K7QM29");
  // Submitted once, when the sixth character landed.
  expect(submitted).toHaveBeenCalledOnce();
});

it("lets in characters no code uses and sends them to be checked", async () => {
  await render(JoinCodeForm, {});
  const input = page.getByLabelText("Invite code");

  await userEvent.click(input);
  await userEvent.keyboard("k7qm2i");
  await expect.element(input).toHaveValue("K7QM2I");
  // No hint about which characters codes use: the server's answer is the
  // same "not an active invite code" as any other wrong code.
  expect(submitted).toHaveBeenCalledOnce();
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

it("cleans up a pasted code", async () => {
  await render(JoinCodeForm, {});
  const input = page.getByLabelText("Invite code");
  await userEvent.click(input);
  // A real paste event, like a long-press Paste on a phone.
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", " k7q-m2x ");
  input
    .element()
    .dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, cancelable: true })
    );
  await expect.element(input).toHaveValue("K7QM2X");
});

it("never leaves text selected, so iOS shows no selection handles", async () => {
  await render(JoinCodeForm, {});
  const input = page.getByLabelText("Invite code");
  const field = input.element() as HTMLInputElement;
  const selection = () => [field.selectionStart, field.selectionEnd];

  await userEvent.click(input);
  await userEvent.keyboard("k7qm2x");
  // A full code keeps a plain caret after it (input-otp selected the last
  // character here, which is what drew the handles).
  await expect.poll(selection).toEqual([6, 6]);
  // Selecting text by hand collapses back to the caret.
  field.setSelectionRange(0, 6);
  await expect.poll(selection).toEqual([6, 6]);
  field.setSelectionRange(2, 2);
  await expect.poll(selection).toEqual([6, 6]);
});

it("takes an autofilled code whole, even over a partial one", async () => {
  await render(JoinCodeForm, {});
  const input = page.getByLabelText("Invite code");
  await userEvent.click(input);
  await userEvent.keyboard("ab");
  // Autofill sets the field's text and fires a plain input event.
  const field = input.element() as HTMLInputElement;
  field.value = "ABK7QM2X";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await expect.element(input).toHaveValue("K7QM2X");
  expect(submitted).toHaveBeenCalledOnce();
});

it("shows the error next to the field", async () => {
  await render(JoinCodeForm, { error: "That's not an active invite code." });
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("That's not an active invite code.");
  await expect
    .element(page.getByLabelText("Invite code"))
    .toHaveAttribute("aria-invalid", "true");
});
