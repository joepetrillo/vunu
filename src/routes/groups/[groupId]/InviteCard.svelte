<script lang="ts">
  import { enhance } from "$app/forms";

  import { ActionForm } from "#lib/action-form.svelte.ts";

  interface Props {
    groupName: string;
    code: string;
    url: string;
    isOwner: boolean;
  }

  let { groupName, code, url, isOwner }: Props = $props();

  // What the share button last did, shown next to it.
  let status = $state<string | null>(null);

  const reset = new ActionForm({
    confirm: () =>
      "Make a new invite? The current link and code will stop working.",
  });

  // Phones open their share sheet (Messages, WhatsApp, …); browsers without
  // one copy the link instead.
  async function share() {
    status = null;
    const text = `Join ${groupName} on Vunu (code ${code})`;
    try {
      // TypeScript's DOM types say every browser has `share`; desktop
      // Firefox doesn't, so check on a plain object.
      if ("share" in (navigator as object)) {
        await navigator.share({ title: text, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      status = "Link copied.";
    } catch (error) {
      // Closing the share sheet without picking anything isn't a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      status = "Couldn't share. Copy the link below instead.";
    }
  }
</script>

<section class="mt-6 rounded border p-4" aria-labelledby="invite-heading">
  <h2 id="invite-heading" class="font-semibold">Invite people</h2>
  <p class="mt-1 text-sm text-neutral-600">
    Anyone with this link or code can join.
  </p>
  <p class="mt-3 font-mono text-3xl tracking-widest" aria-label="Invite code">
    {code}
  </p>
  <p class="mt-1 text-sm break-all text-neutral-600">{url}</p>

  <div class="mt-3 flex flex-wrap items-center gap-2">
    <button
      class="rounded bg-black px-3 py-1.5 text-sm text-white"
      onclick={share}
    >
      Share invite
    </button>
    {#if isOwner}
      <form method="POST" action="?/resetInvite" use:enhance={reset.submit}>
        <button
          class="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={reset.saving}
        >
          {reset.saving ? "Resetting…" : "Reset invite"}
        </button>
      </form>
    {/if}
  </div>
  <!-- Polite: announced after whatever the screen reader is saying. -->
  <p class="mt-2 text-sm" aria-live="polite">{status}</p>
  {#if reset.error}
    <p class="mt-2 text-sm text-red-700" role="alert">{reset.error}</p>
  {/if}
</section>
