<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import type { HTMLInputAttributes } from "svelte/elements";

  import { cn } from "#lib/utils.ts";

  type Props = Omit<
    HTMLInputAttributes,
    "value" | "maxlength" | "type" | "class" | "children"
  > & {
    value?: string;
    /** How many boxes, and the most characters the code can have. */
    length: number;
    /** Turns whatever was typed, pasted, or autofilled into code characters
     *  (e.g. strips everything but digits). */
    clean: (text: string) => string;
    /** Shows the boxes in the error color. */
    invalid?: boolean;
  };

  let {
    value = $bindable(""),
    length,
    clean,
    invalid = false,
    inputmode = "numeric",
    autocomplete = "one-time-code",
    ...rest
  }: Props = $props();

  let focused = $state(false);
  const boxes = $derived(
    Array.from({ length }, (_, position) => value[position] ?? "")
  );

  // Sets the code from the field's new text. The caret is always at the end,
  // so new text follows the old.
  function update(input: HTMLInputElement, text: string) {
    const previous = value;
    let next = clean(text);
    if (next.length > length) {
      // New characters replace boxes from the end: a key typed into a full
      // code replaces the last box, and a whole pasted or autofilled code
      // replaces them all.
      const added = next.startsWith(previous)
        ? next.slice(previous.length)
        : next;
      next =
        added.length >= length
          ? added.slice(0, length)
          : previous.slice(0, length - added.length) + added;
    }
    // Writing the value back also drops refused characters from the field.
    input.value = next;
    value = next;
    // Filling the last box submits the form, so a code from the keyboard's
    // suggestion bar signs in with one tap.
    if (previous.length < length && next.length === length) {
      input.form?.requestSubmit();
    }
  }

  function oninput(event: Event & { currentTarget: HTMLInputElement }) {
    update(event.currentTarget, event.currentTarget.value);
  }

  // Handled here so a paste always lands the same way, cleaned as a whole
  // ("k7q-m2x" is seven characters before its dash goes).
  function onpaste(
    event: ClipboardEvent & { currentTarget: HTMLInputElement }
  ) {
    event.preventDefault();
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    update(event.currentTarget, value + pasted);
  }

  // Keeps the caret after the last character and never lets a range stay
  // selected. iOS draws blue selection handles for any selected range, and
  // the boxes cover the real text, so the handles would float over the first
  // box (shadcn's input-otp selected the last character to mark its box,
  // which is what showed them after every autofill).
  // An attachment (Svelte 5) runs when the input mounts and returns its
  // cleanup, like a React ref callback with a teardown.
  const caretAtEnd: Attachment<HTMLInputElement> = (input) => {
    function collapse() {
      if (document.activeElement !== input) return;
      const end = input.value.length;
      if (input.selectionStart !== end || input.selectionEnd !== end) {
        input.setSelectionRange(end, end);
      }
    }
    // Text fields report selection changes on the document.
    document.addEventListener("selectionchange", collapse);
    return () => {
      document.removeEventListener("selectionchange", collapse);
    };
  };
</script>

<!-- One box per character, drawn under a single real input whose text is
     invisible: typing, pasting, and a phone's code autofill all work as on a
     normal field, and the form submits it under its `name`. -->
<div class="relative w-full cursor-text has-disabled:opacity-50">
  <div
    aria-hidden="true"
    class={cn(
      "flex w-full items-center rounded-4xl",
      invalid && "ring-[3px] ring-destructive/20 dark:ring-destructive/40"
    )}
  >
    <!-- Keyed by position: that's what a box is. -->
    {#each boxes as char, position (position)}
      <div
        class={cn(
          "relative flex h-14 flex-1 items-center justify-center border-y border-r border-input bg-input/30 font-mono text-2xl transition-all first:rounded-l-4xl first:border-l last:rounded-r-4xl",
          invalid && "border-destructive"
        )}
      >
        {char}
        <!-- A blinking caret in the box the next character lands in. -->
        {#if focused && position === value.length}
          <div
            class="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div
              class="h-4 w-px animate-caret-blink bg-foreground duration-1000"
            ></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <input
    {...rest}
    {value}
    {inputmode}
    {autocomplete}
    type="text"
    spellcheck="false"
    aria-invalid={invalid || undefined}
    class="code-input"
    {oninput}
    {onpaste}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
    {@attach caretAtEnd}
  />
</div>

<style>
  /* Covers the boxes so a tap anywhere focuses it. Its text is transparent
     and squeezed to the left edge (monospace characters are 0.6em wide), so
     the caret sits there too. iOS Safari draws the caret even with
     caret-color: transparent; the clip hides that left strip, which is only
     the first box's rounded corner. */
  .code-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: transparent;
    -webkit-text-fill-color: transparent;
    caret-color: transparent;
    font-family: monospace;
    /* Large, so iOS never zooms in on focus. */
    font-size: 3.5rem;
    line-height: 1;
    letter-spacing: -0.6em;
    text-align: left;
    clip-path: inset(0 0 0 0.75rem);
  }

  .code-input::selection {
    background: transparent;
    color: transparent;
  }

  /* Browsers paint autofilled fields; keep this one invisible. */
  .code-input:autofill {
    background: transparent !important;
    box-shadow: none !important;
    -webkit-text-fill-color: transparent !important;
  }

  /* Separate rule: a browser drops a whole selector list it can't parse. */
  .code-input:-webkit-autofill {
    background: transparent !important;
    -webkit-box-shadow: none !important;
    -webkit-text-fill-color: transparent !important;
  }
</style>
