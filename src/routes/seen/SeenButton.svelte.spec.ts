import type { ActionResult } from "$app/forms";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";

import type { SubmitFunction } from "./$types";
import SeenButton from "./SeenButton.svelte";

const enhancement = vi.hoisted<{ submit: SubmitFunction | undefined }>(() => ({
  submit: undefined,
}));
// Capture the framework callback so refresh/navigation rejection can be
// injected; the component and its rendered disabled/error states are real.
vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    enhancement.submit = submit;
  },
}));
vi.mock("$app/state", () => ({
  page: { url: new URL("http://localhost:4173/seen?scope=all") },
}));

const cases = [
  {
    result: { type: "success", status: 200, location: "/seen?scope=all" },
    message: "Saved, but couldn't refresh. Reload the page.",
  },
  {
    result: { type: "redirect", status: 303, location: "/sign-in" },
    message: "Couldn't open the page. Reload to continue.",
  },
] satisfies {
  result: ActionResult<never, { message: string }>;
  message: string;
}[];

it.each(cases)(
  "releases the button and reports $result.type accurately when update rejects",
  async ({ result, message }) => {
    await render(SeenButton, { movieId: 1, title: "Test movie", seen: false });
    const form = document.querySelector<HTMLInputElement>(
      'input[name="movieId"]'
    )?.form;
    if (!form || !enhancement.submit)
      throw new Error("Seen button didn't initialize its enhanced form.");

    const input = {
      action: new URL(form.action),
      formData: new FormData(form),
      formElement: form,
      controller: new AbortController(),
      submitter: null,
      cancel: vi.fn(),
    };
    const complete = await enhancement.submit(input);
    if (typeof complete !== "function")
      throw new Error("Submission didn't return a result handler.");

    const button = page.getByRole("button", { name: "Seen it: Test movie" });
    await expect.element(button).toBeDisabled();
    const update = vi.fn().mockRejectedValue(new Error("Refresh unavailable"));
    await complete({ ...input, result, update });

    expect(update).toHaveBeenCalledOnce();
    await expect.element(button).toBeEnabled();
    await expect.element(page.getByRole("alert")).toHaveTextContent(message);
  }
);
