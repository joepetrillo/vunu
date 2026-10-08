<script lang="ts">
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";

  import { ActionForm } from "#lib/action-form.svelte.ts";
  import { NICKNAME_MAX } from "#lib/group-fields.ts";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  const join = new ActionForm();
</script>

<svelte:head>
  <title>{data.found ? `Join ${data.group.name}` : "Invite"} · Vunu</title>
</svelte:head>

<main class="mx-auto max-w-xl p-4">
  <a class="text-sm underline" href={resolve("/")}>Home</a>
  {#if data.found}
    <h1 class="mt-2 text-2xl font-bold break-words">
      Join {data.group.name}?
    </h1>
    <form class="mt-4" method="POST" use:enhance={join.submit}>
      <input type="hidden" name="groupId" value={data.group.id} />
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
      <p class="mt-1 text-xs text-neutral-600">
        Only people in this group see it. You can change it later.
      </p>
      <button
        class="mt-4 rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        disabled={join.saving}
      >
        {join.saving ? "Joining…" : "Join group"}
      </button>
      {#if join.error}
        <p class="mt-2 text-sm text-red-700" role="alert">{join.error}</p>
      {/if}
    </form>
  {:else}
    <h1 class="mt-2 text-2xl font-bold">Can't use this invite</h1>
    <p class="mt-2" role="alert">{data.message}</p>
    <p class="mt-4 text-sm">
      <a class="underline" href={resolve("/join")}>Enter a code</a>
    </p>
  {/if}
</main>
