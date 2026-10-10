<script lang="ts">
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";

  import { ActionForm } from "#lib/action-form.svelte.ts";
  import { GROUP_NAME_MAX, NICKNAME_MAX } from "#lib/group-fields.ts";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  // The browser names the new group, so a retry lands on the same one.
  const create = new ActionForm({ newIds: ["groupId"] });
</script>

<svelte:head><title>New group · Vunu</title></svelte:head>

<main class="mx-auto max-w-xl p-4">
  <a class="text-sm underline" href={resolve("/")}>Home</a>
  <h1 class="mt-2 text-2xl font-bold">New group</h1>

  <form
    class="mt-4 flex flex-col gap-4"
    method="POST"
    use:enhance={create.submit}
  >
    <label class="flex flex-col text-sm">
      Group name
      <input
        class="mt-1 rounded border px-2 py-1.5"
        name="name"
        required
        maxlength={GROUP_NAME_MAX}
        autocomplete="off"
        placeholder="Friday movie night"
      />
    </label>
    <label class="flex flex-col text-sm">
      What should this group call you?
      <input
        class="mt-1 rounded border px-2 py-1.5"
        name="nickname"
        value={data.nickname}
        required
        maxlength={NICKNAME_MAX}
        autocomplete="nickname"
      />
    </label>
    <div>
      <button
        class="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        disabled={create.saving}
      >
        {create.saving ? "Creating…" : "Create group"}
      </button>
      {#if create.error}
        <p class="mt-2 text-sm text-red-700" role="alert">{create.error}</p>
      {/if}
    </div>
  </form>
</main>
