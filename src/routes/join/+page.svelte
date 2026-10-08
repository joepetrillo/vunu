<script lang="ts">
  import { resolve } from "$app/paths";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head><title>Join a group · Vunu</title></svelte:head>

<main class="mx-auto max-w-xl p-4">
  <a class="text-sm underline" href={resolve("/")}>Home</a>
  <h1 class="mt-2 text-2xl font-bold">Join a group</h1>
  <p class="mt-1 text-sm text-neutral-600">
    Enter the 6-character code someone in the group shared with you.
  </p>

  <form class="mt-4 flex items-end gap-2">
    <label class="flex flex-col text-sm">
      Invite code
      <input
        class="mt-1 w-36 rounded border px-2 py-1.5 font-mono uppercase"
        name="code"
        value={data.typed}
        required
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        aria-invalid={data.invalid}
        aria-describedby={data.invalid ? "code-error" : undefined}
      />
    </label>
    <button class="rounded bg-black px-3 py-1.5 text-sm text-white">
      Join
    </button>
  </form>
  {#if data.invalid}
    <p id="code-error" class="mt-2 text-sm text-red-700" role="alert">
      That's not an invite code. Codes are 6 letters and numbers, like K7QM2X.
    </p>
  {/if}
</main>
