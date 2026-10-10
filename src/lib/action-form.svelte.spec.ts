import type { ActionResult, SubmitFunction } from "$app/forms";
import { describe, expect, it, vi } from "vitest";

import { ActionForm } from "./action-form.svelte.ts";

type SubmitInput = Parameters<SubmitFunction>[0];
type Callback = Exclude<Awaited<ReturnType<SubmitFunction>>, void>;

// Submits `fields` the way `use:enhance` would and returns what was sent,
// plus a function that delivers the server's answer.
function submit(form: ActionForm, fields: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  const cancel = vi.fn();
  // Only the parts ActionForm reads; the rest of the input doesn't matter.
  const callback = form.submit({ formData, cancel } as unknown as SubmitInput);
  return {
    sent: Object.fromEntries(formData) as Record<string, string>,
    cancel,
    async answer(result: ActionResult) {
      await (callback as Callback)({
        result,
        update: () => Promise.resolve(),
      } as unknown as Parameters<Callback>[0]);
    },
  };
}

const location = "/groups/1";
const noAnswer: ActionResult = {
  type: "error",
  error: { message: "offline", status: 500 },
  location,
};
const refused: ActionResult = {
  type: "failure",
  status: 409,
  data: { message: "Someone in this group already goes by that name." },
  location,
};

describe("ActionForm", () => {
  it("resends the same IDs after a request got no answer", async () => {
    const form = new ActionForm({ newIds: ["groupId"] });
    const first = submit(form, { name: "Movie night" });
    await first.answer(noAnswer);
    expect(form.error).toMatch(/Couldn't save/);

    const retry = submit(form, { name: "Movie night" });
    expect(retry.sent.actionId).toBe(first.sent.actionId);
    expect(retry.sent.groupId).toBe(first.sent.groupId);
  });

  it("uses new IDs once the server answered, or when the input changed", async () => {
    const form = new ActionForm();
    const first = submit(form, { nickname: "Sam" });
    await first.answer(refused);
    expect(form.error).toBe("Someone in this group already goes by that name.");

    const second = submit(form, { nickname: "Sam" });
    expect(second.sent.actionId).not.toBe(first.sent.actionId);
    await second.answer(noAnswer);

    const changed = submit(form, { nickname: "Samuel" });
    expect(changed.sent.actionId).not.toBe(second.sent.actionId);
  });

  it("sends nothing while saving or when the question is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const form = new ActionForm({ confirm: () => "Delete it?" });
    expect(submit(form, {}).cancel).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith("Delete it?");

    confirm.mockReturnValue(true);
    const first = submit(form, {});
    expect(first.cancel).not.toHaveBeenCalled();
    expect(form.saving).toBe(true);
    expect(submit(form, {}).cancel).toHaveBeenCalled();
    await first.answer({ type: "success", status: 204, location });
    expect(form.saving).toBe(false);
    confirm.mockRestore();
  });
});
