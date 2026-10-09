<script lang="ts">
  import { enhance } from "$app/forms";
  import type { Attachment } from "svelte/attachments";

  import {
    INVITE_CODE_ALPHABET,
    INVITE_CODE_LENGTH,
  } from "#lib/group-fields.ts";

  interface Props {
    /** The page's `findInvite` answer, or a dead link's message. */
    error?: string | undefined;
  }

  let { error }: Props = $props();

  let code = $state("");
  const notInCode = new RegExp(`[^${INVITE_CODE_ALPHABET}]`, "g");

  // Rewrites what was typed or pasted into something that could be a code:
  // uppercase, only the code's characters ("k7q-m2x" becomes "K7QM2X"), and
  // no more than six. Not `maxlength`: it would cut a pasted "K7Q-M2X" at
  // the dash before the dash is removed.
  function keepCodeCharacters(
    event: Event & { currentTarget: HTMLInputElement }
  ) {
    code = event.currentTarget.value
      .toUpperCase()
      .replace(notInCode, "")
      .slice(0, INVITE_CODE_LENGTH);
    // Svelte only updates the DOM when `code` changes; a rejected character
    // leaves `code` as it was, so put the cleaned value back by hand.
    event.currentTarget.value = code;
  }

  // iOS Safari focuses this field when the page loads, opening the keyboard
  // on every refresh (seen on an iPhone; desktop browsers don't). Undo any
  // focus that arrives before the person has tapped or pressed a key on the
  // page; a real tap, or Tab, still focuses it.
  const ignoreFocusBeforeInteraction: Attachment<HTMLInputElement> = (
    input
  ) => {
    let interacted = false;
    const interact = () => {
      interacted = true;
    };
    const onFocus = () => {
      if (!interacted) input.blur();
    };
    // Capture: counts the interaction before the focus it causes.
    const options = { capture: true, once: true } as const;
    document.addEventListener("pointerdown", interact, options);
    document.addEventListener("keydown", interact, options);
    input.addEventListener("focus", onFocus);
    if (document.activeElement === input) input.blur();
    return () => {
      document.removeEventListener("pointerdown", interact, options);
      document.removeEventListener("keydown", interact, options);
      input.removeEventListener("focus", onFocus);
    };
  };
</script>

<!-- Posts to the current page's `find` action (see findInvite). -->
<form
  class="mt-4"
  method="POST"
  action="?/find"
  use:enhance={() =>
    // Keep the wrong code visible next to its error.
    ({ update }) =>
      update({ reset: false })}
>
  <div class="flex items-end gap-2">
    <label class="flex flex-col text-sm">
      Join with a code
      <input
        class="mt-1 w-36 rounded border px-2 py-1.5 font-mono tracking-widest uppercase"
        name="code"
        value={code}
        oninput={keepCodeCharacters}
        {@attach ignoreFocusBeforeInteraction}
        required
        minlength={INVITE_CODE_LENGTH}
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : "code-error"}
      />
    </label>
    <button class="rounded border px-3 py-1.5 text-sm">Join</button>
  </div>
  {#if error}
    <p id="code-error" class="mt-2 text-sm text-red-700" role="alert">
      {error}
    </p>
  {/if}
</form>
