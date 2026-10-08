<script lang="ts">
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";

  import { ActionForm } from "#lib/action-form.svelte.ts";
  import { GROUP_NAME_MAX, NICKNAME_MAX } from "#lib/group-fields.ts";

  import type { PageProps } from "./$types";
  import InviteCard from "./InviteCard.svelte";

  let { data }: PageProps = $props();

  let group = $derived(data.group);
  let isOwner = $derived(group.me.role === "owner");
  // Members are ordered by when they joined, so this is who'd take over.
  let nextOwner = $derived(
    group.members.find((member) => member.userId !== group.me.userId)
  );

  function nicknameOf(userId: FormDataEntryValue | null): string {
    return (
      group.members.find((member) => member.userId === userId)?.nickname ??
      "this person"
    );
  }

  const rename = new ActionForm();
  const nickname = new ActionForm();
  const remove = new ActionForm({
    confirm: (formData) =>
      `Remove ${nicknameOf(formData.get("memberId"))} from ${group.name}? They can rejoin with the invite.`,
  });
  const leave = new ActionForm({
    confirm: () =>
      nextOwner === undefined
        ? `Leave ${group.name}? You're the last one in it, so the group will be deleted.`
        : isOwner
          ? `Leave ${group.name}? ${nextOwner.nickname} will become the owner.`
          : `Leave ${group.name}?`,
  });
  const deletion = new ActionForm({
    confirm: () => `Delete ${group.name} for everyone? This can't be undone.`,
  });
</script>

<svelte:head><title>{group.name} · Vunu</title></svelte:head>

<main class="mx-auto max-w-xl p-4">
  <a class="text-sm underline" href={resolve("/")}>Home</a>
  <h1 class="mt-2 text-2xl font-bold break-words">{group.name}</h1>

  <InviteCard
    groupName={group.name}
    code={group.inviteCode}
    url={data.inviteUrl}
    {isOwner}
  />

  <section class="mt-6" aria-labelledby="members-heading">
    <h2 id="members-heading" class="font-semibold">
      Members ({group.members.length})
    </h2>
    <ul class="mt-2 divide-y rounded border">
      {#each group.members as member (member.userId)}
        <li class="flex items-center justify-between gap-4 p-3">
          <span class="min-w-0 break-words">
            {member.nickname}
            {#if member.userId === group.me.userId}
              <span class="text-sm text-neutral-600">(you)</span>
            {/if}
            {#if member.role === "owner"}
              <span class="ml-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                Owner
              </span>
            {/if}
          </span>
          {#if isOwner && member.userId !== group.me.userId}
            <form
              method="POST"
              action="?/removeMember"
              use:enhance={remove.submit}
            >
              <input type="hidden" name="memberId" value={member.userId} />
              <button
                class="rounded border px-3 py-1 text-sm disabled:opacity-50"
                disabled={remove.saving}
                aria-label={`Remove ${member.nickname}`}
              >
                Remove
              </button>
            </form>
          {/if}
        </li>
      {/each}
    </ul>
    {#if remove.error}
      <p class="mt-2 text-sm text-red-700" role="alert">{remove.error}</p>
    {/if}
  </section>

  <section class="mt-6" aria-labelledby="settings-heading">
    <h2 id="settings-heading" class="font-semibold">Settings</h2>

    <form
      class="mt-2"
      method="POST"
      action="?/nickname"
      use:enhance={nickname.submit}
    >
      <label class="flex flex-col text-sm">
        Your name in this group
        <span class="mt-1 flex gap-2">
          <input
            class="min-w-0 flex-1 rounded border px-2 py-1.5"
            name="nickname"
            value={group.me.nickname}
            required
            maxlength={NICKNAME_MAX}
            autocomplete="nickname"
          />
          <button
            class="rounded border px-3 py-1.5 disabled:opacity-50"
            disabled={nickname.saving}
          >
            {nickname.saving ? "Saving…" : "Save"}
          </button>
        </span>
      </label>
      {#if nickname.error}
        <p class="mt-2 text-sm text-red-700" role="alert">{nickname.error}</p>
      {/if}
    </form>

    {#if isOwner}
      <form
        class="mt-4"
        method="POST"
        action="?/rename"
        use:enhance={rename.submit}
      >
        <label class="flex flex-col text-sm">
          Group name
          <span class="mt-1 flex gap-2">
            <input
              class="min-w-0 flex-1 rounded border px-2 py-1.5"
              name="name"
              value={group.name}
              required
              maxlength={GROUP_NAME_MAX}
              autocomplete="off"
            />
            <button
              class="rounded border px-3 py-1.5 disabled:opacity-50"
              disabled={rename.saving}
            >
              {rename.saving ? "Saving…" : "Rename"}
            </button>
          </span>
        </label>
        {#if rename.error}
          <p class="mt-2 text-sm text-red-700" role="alert">{rename.error}</p>
        {/if}
      </form>
    {/if}

    <div class="mt-6 flex flex-wrap gap-2">
      <form method="POST" action="?/leave" use:enhance={leave.submit}>
        <button
          class="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={leave.saving}
        >
          {leave.saving ? "Leaving…" : "Leave group"}
        </button>
      </form>
      {#if isOwner}
        <form method="POST" action="?/delete" use:enhance={deletion.submit}>
          <button
            class="rounded border border-red-700 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
            disabled={deletion.saving}
          >
            {deletion.saving ? "Deleting…" : "Delete group"}
          </button>
        </form>
      {/if}
    </div>
    {#if leave.error}
      <p class="mt-2 text-sm text-red-700" role="alert">{leave.error}</p>
    {/if}
    {#if deletion.error}
      <p class="mt-2 text-sm text-red-700" role="alert">
        {deletion.error}
      </p>
    {/if}
  </section>
</main>
