import type { SubmitFunction } from "$app/forms";

interface Options {
  /**
   * Hidden fields that get a fresh UUID with each new action ID, kept with
   * it: a new group's ID, say, so a retried "create" names the same group.
   */
  newIds?: readonly string[];
  /**
   * What the action applies to when that isn't in the form (the group in the
   * URL, say). Part of the input, so an ID kept for one group is never
   * resent for another when the page is reused for a different group.
   */
  scope?: () => string;
}

/**
 * The save state of one `use:enhance` form whose action takes an action ID.
 *
 * The ID rule (spec section 4): the browser keeps an action's ID until the
 * server answers, so trying again after a dropped connection resends it and
 * the server recognizes the retry. Changed input is a different action and
 * gets a new ID. Like SeenButton.svelte, generalized for any form's fields.
 *
 * A class with `$state` fields is Svelte 5's way to share reactive logic: the
 * template reads `form.saving` and updates when it changes, with no store.
 */
export class ActionForm {
  saving = $state(false);
  error = $state<string | null>(null);

  readonly #options: Options;
  // Plain field: nothing on screen depends on it.
  #unanswered: { input: string; ids: Record<string, string> } | null = null;

  constructor(options: Options = {}) {
    this.#options = options;
  }

  // An arrow function, so `this` still works when `use:enhance` calls it.
  submit: SubmitFunction = ({ formData, cancel }) => {
    // Questions ("Leave this group?") are asked before submitting, in a
    // ConfirmDialog; by the time the form submits, the answer was yes.
    if (this.saving) {
      cancel();
      return;
    }

    const idFields = ["actionId", ...(this.#options.newIds ?? [])];
    // What the person asked for: every field except the generated IDs.
    const input = JSON.stringify([
      this.#options.scope?.() ?? null,
      ...[...formData].filter(([name]) => !idFields.includes(name)),
    ]);
    if (this.#unanswered?.input !== input) {
      this.#unanswered = {
        input,
        ids: Object.fromEntries(
          idFields.map((name) => [name, crypto.randomUUID()])
        ),
      };
    }
    for (const [name, value] of Object.entries(this.#unanswered.ids)) {
      formData.set(name, value);
    }
    this.saving = true;
    this.error = null;

    return async ({ result, update }) => {
      try {
        // No answer from the server (dropped connection, server error): the
        // change may have gone through, so keep the IDs for a retry.
        if (result.type === "error") {
          this.error = "Couldn't save. Check your connection and try again.";
          return;
        }
        this.#unanswered = null;
        if (result.type === "failure") {
          this.error = messageOf(result.data);
          return;
        }
        // Success refreshes the page's data; a redirect navigates. `reset:
        // false` keeps what's typed, which now matches the saved value.
        try {
          await update({ reset: false });
        } catch {
          // A redirect's page (often sign-in) failed to open; it may not
          // mean anything was saved, so it doesn't say so.
          this.error =
            result.type === "success"
              ? "Saved, but couldn't refresh. Reload the page."
              : "Couldn't open the page. Reload to continue.";
        }
      } finally {
        this.saving = false;
      }
    };
  };
}

// Actions answer refusals with `fail(status, { message })`.
function messageOf(data: unknown): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof data.message === "string"
  ) {
    return data.message;
  }
  return "Couldn't save. Try again.";
}
